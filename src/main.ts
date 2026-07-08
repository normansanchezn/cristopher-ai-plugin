import {
	App,
	Component,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	requestUrl,
	Setting,
	setIcon,
	TFile,
	WorkspaceLeaf
} from "obsidian";

const VIEW_TYPE_BRAIN_CHAT = "christopher-ai-chat-view";
const MAX_COMPACT_MESSAGE_LENGTH = 200;
const RECOMMENDED_DEFAULT_MODEL = "gemma4:e4b";

interface BrainChatSettings {
	ollamaBaseUrl: string;
	chatModel: string;
	maxNotes: number;
	maxCharsPerNote: number;
}

interface BrainCandidate {
	file: TFile;
	score: number;
	reason: string;
	tags: string[];
	properties: Record<string, unknown>;
	title: string;
	metadataScore: number;
}

interface OllamaTagsResponse {
	models?: Array<{ name?: string }>;
}

interface OllamaChatResponse {
	message?: { content?: string };
}

const RECOMMENDED_LIGHT_MODELS = [
	{ name: "gemma4:e4b", reason: "Recommended for reading and analyzing notes." },
	{ name: "llama3.2:3b", reason: "Lightweight and good enough for simple questions." },
	{ name: "phi3:mini", reason: "Very lightweight for quick responses." },
	{ name: "qwen2.5:3b", reason: "Good general-purpose balance." }
];

const PROMPT_HINTS = [
	"¿Tienes dudas? Yo te la resuelvo.",
	"Busca algo en tu Brain...",
	"Pregúntame qué documentaste últimamente.",
	"¿Qué pasó en el último sprint?",
	"Te puedo resumir una decisión técnica.",
	"Pregúntame por un bug que hayas documentado.",
	"¿Qué estabas haciendo con OpenClaw?",
	"¿Qué notas tienes sobre este proyecto?",
	"Busca una idea perdida en tu Brain.",
	"¿Quieres que conecte notas por tags?",
	"Te puedo explicar una nota vieja.",
	"¿Qué pendientes hay en tus proyectos?",
	"Pregúntame por Shell Atlas.",
	"¿Qué aprendiste esta semana?",
	"Busca decisiones, blockers o bugs.",
	"¿Qué dice tu Brain sobre esto?",
	"Pregúntame algo del vault.",
	"Te puedo encontrar contexto rápido.",
	"¿Qué documentaste sobre esta feature?",
	"¿Qué quieres recordar?"
];

const DEFAULT_SETTINGS: BrainChatSettings = {
	ollamaBaseUrl: "http://localhost:11434",
	chatModel: RECOMMENDED_DEFAULT_MODEL,
	maxNotes: 10,
	maxCharsPerNote: 2200
};

function normalizeSettings(data: unknown): BrainChatSettings {
	if (!data || typeof data !== "object") return { ...DEFAULT_SETTINGS };

	const source = data as Partial<BrainChatSettings>;

	return {
		ollamaBaseUrl: typeof source.ollamaBaseUrl === "string"
			? source.ollamaBaseUrl
			: DEFAULT_SETTINGS.ollamaBaseUrl,
		chatModel: typeof source.chatModel === "string"
			? source.chatModel
			: DEFAULT_SETTINGS.chatModel,
		maxNotes: typeof source.maxNotes === "number"
			? source.maxNotes
			: DEFAULT_SETTINGS.maxNotes,
		maxCharsPerNote: typeof source.maxCharsPerNote === "number"
			? source.maxCharsPerNote
			: DEFAULT_SETTINGS.maxCharsPerNote
	};
}

function normalizeBaseUrl(url: string): string {
	return url.trim().replace(/\/$/, "");
}

function normalizeToken(value: string): string {
	return value
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^\p{L}\p{N}_-]/gu, "")
		.trim();
}

function extractQueryTerms(question: string): string[] {
	const stopWords = new Set([
		"como", "para", "pero", "esto", "esta", "este", "tengo", "tiene",
		"sobre", "segun", "cual", "cuales", "donde", "cuando", "porque",
		"pregunta", "notas", "brain", "vault", "archivo", "archivos",
		"basado", "basandome", "dime", "explica", "ayuda", "puedes"
	]);

	const terms = question
		.split(/\s+/)
		.map(normalizeToken)
		.filter((word) => word.length > 2 && !stopWords.has(word));

	return Array.from(new Set(terms));
}

function normalizeTag(value: string): string {
	return value.replace(/^#/, "").trim();
}

function humanizePropertyValue(value: unknown): string {
	if (Array.isArray(value)) return value.map(humanizePropertyValue).join(", ");
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return value.toString();
	}
	return "";
}

function getHeadingTitleFromCache(file: TFile, app: App): string {
	const cache = app.metadataCache.getFileCache(file);
	const firstHeading = cache?.headings?.find((heading) => heading.level === 1);
	return firstHeading?.heading?.trim() || file.basename;
}

function scoreTermAgainstValue(term: string, value: string, exactScore: number, partialScore: number): number {
	const normalized = normalizeToken(value);
	if (!normalized) return 0;
	if (normalized === term) return exactScore;
	if (normalized.includes(term)) return partialScore;
	return 0;
}

function recencyScore(file: TFile): number {
	const ageMs = Date.now() - file.stat.mtime;
	const ageDays = ageMs / (1000 * 60 * 60 * 24);

	if (ageDays <= 7) return 5;
	if (ageDays <= 30) return 3;
	if (ageDays <= 90) return 1;
	return 0;
}

function formatModifiedDate(file: TFile): string {
	return new Date(file.stat.mtime).toISOString();
}

function randomPromptHint(): string {
	return PROMPT_HINTS[Math.floor(Math.random() * PROMPT_HINTS.length)] ?? "Pregúntame algo del vault.";
}

async function openBrainLink(app: App, rawValue: string, sourcePath: string): Promise<void> {
	const cleaned = decodeURIComponent(rawValue)
		.replace(/^obsidian:\/\//, "")
		.replace(/^\[\[/, "")
		.replace(/\]\]$/, "")
		.trim();

	if (!cleaned) return;

	await app.workspace.openLinkText(cleaned, sourcePath, false);
}

function wireBrainLinks(app: App, containerEl: HTMLElement, sourcePath: string): void {
	const links = containerEl.querySelectorAll("a");

	for (const link of Array.from(links)) {
		const href = link.getAttribute("href") ?? "";
		const text = link.textContent?.trim() ?? "";

		const candidateFromHref = href
			.replace(/^app:\/\/obsidian.md\//, "")
			.replace(/^obsidian:\/\//, "")
			.trim();

		const candidate = candidateFromHref || text;

		if (!candidate.includes(".md") && !candidate.includes("/")) continue;

		link.addEventListener("click", (event) => {
			event.preventDefault();
			void openBrainLink(app, candidate, sourcePath).catch((error) => {
				console.error("Christopher AI could not open link:", error);
			});
		});
	}
}

export default class ChristopherAIPlugin extends Plugin {
	settings!: BrainChatSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_BRAIN_CHAT,
			(leaf) => new BrainChatView(leaf, this)
		);

		this.addRibbonIcon("bot", "Christopher AI", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-chat",
			name: "Open chat",
			callback: () => {
				void this.activateView();
			}
		});

		this.addSettingTab(new BrainChatSettingTab(this.app, this));
	}

	async activateView() {
		const leaf = this.app.workspace.getRightLeaf(false);

		if (!leaf) {
			new Notice("No pude abrir el panel.");
			return;
		}

		await leaf.setViewState({
			type: VIEW_TYPE_BRAIN_CHAT,
			active: true
		});

		await this.app.workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async fetchInstalledModels(): Promise<string[]> {
		const baseUrl = normalizeBaseUrl(this.settings.ollamaBaseUrl);
		const response = await requestUrl({
			url: `${baseUrl}/api/tags`,
			method: "GET",
			throw: false
		});

		if (response.status < 200 || response.status >= 300) {
			throw new Error(`No pude leer modelos de Ollama: ${response.status} ${response.text}`);
		}

		const json = response.json as OllamaTagsResponse;

		return (json.models ?? [])
			.map((model) => model.name)
			.filter((name): name is string => Boolean(name))
			.sort((a: string, b: string) => a.localeCompare(b));
	}

	async hasModel(modelName: string): Promise<boolean> {
		const installedModels = await this.fetchInstalledModels();
		return installedModels.some((installedModel) => installedModel === modelName);
	}

	async openOllamaDownload(): Promise<void> {
		window.open("https://ollama.com/download");
	}
}

class BrainChatView extends ItemView {
	plugin: ChristopherAIPlugin;
	messagesEl!: HTMLElement;
	inputEl!: HTMLTextAreaElement;
	sendButtonEl!: HTMLButtonElement;
	stopButtonEl!: HTMLButtonElement;
	emptyStateEl!: HTMLElement;
	abortController: AbortController | null = null;
	loadingBubbleEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ChristopherAIPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_BRAIN_CHAT;
	}

	getDisplayText() {
		return "Christopher AI";
	}

	async getOwnerContext(): Promise<string> {
		const files = this.app.vault.getMarkdownFiles();

		const ownerCandidates = files.filter((file) => {
			if (this.shouldIgnoreFile(file)) return false;

			const name = file.basename.toLowerCase();
			const tags = this.getTagsForFile(file).map((tag) => tag.toLowerCase());
			const properties = this.getPropertiesForFile(file);
			const area = humanizePropertyValue(properties.area).toLowerCase();

			return (
				name === "owner" ||
				name === "profile" ||
				name === "me" ||
				name === "about" ||
				tags.includes("iam") ||
				tags.includes("profile") ||
				tags.includes("personal-information") ||
				tags.includes("area/identidad") ||
				tags.includes("type/perfil") ||
				area === "identidad"
			);
		});

		const sortedCandidates = ownerCandidates.sort((a, b) => {
			const aName = a.basename.toLowerCase();
			const bName = b.basename.toLowerCase();

			if (aName === "owner") return -1;
			if (bName === "owner") return 1;

			if (aName === "profile") return -1;
			if (bName === "profile") return 1;

			return a.path.localeCompare(b.path);
		});

		const best = sortedCandidates[0];

		if (!best) {
			return "No owner profile note found.";
		}

		const content = await this.app.vault.cachedRead(best);

		return [
			`OWNER_SOURCE: ${best.path}`,
			"OWNER_CONTEXT:",
			content.slice(0, 2500)
		].join("\n");
	}

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClasses(["brain-chat-container", "view-content"]);

		const header = container.createDiv("brain-chat-header");
		const titlePill = header.createDiv("brain-chat-title-pill");
		titlePill.createSpan({ text: "🧠" });
		titlePill.createSpan({ text: "Christopher AI" });

		header.createSpan({
			cls: "brain-chat-header-subtitle",
			text: "Powered by your vault"
		});

		this.messagesEl = container.createDiv("brain-chat-messages");
		await this.renderEmptyState();

		const composer = container.createDiv("brain-chat-composer");

		this.inputEl = composer.createEl("textarea", {
			cls: "brain-chat-input",
			placeholder: randomPromptHint()
		});

		const actions = composer.createDiv("brain-chat-composer-actions");

		this.sendButtonEl = actions.createEl("button", {
			cls: "brain-chat-icon-button brain-chat-send-button",
			attr: { "aria-label": "Enviar" }
		});
		setIcon(this.sendButtonEl, "send");

		this.stopButtonEl = actions.createEl("button", {
			cls: "brain-chat-icon-button brain-chat-stop-button",
			attr: { "aria-label": "Detener" }
		});
		setIcon(this.stopButtonEl, "square");

		this.setThinking(false);

		this.sendButtonEl.onclick = () => {
			void this.submitPrompt();
		};
		this.stopButtonEl.onclick = () => this.stopCurrentRequest();

		this.inputEl.addEventListener("input", () => this.autoResizeInput());

		this.inputEl.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				void this.submitPrompt();
			}
		});
	}

	async renderEmptyState() {
		this.emptyStateEl = this.messagesEl.createDiv("brain-chat-empty-state");

		this.emptyStateEl.createDiv({
			cls: "brain-chat-empty-orb",
			text: "🧠"
		});

		this.emptyStateEl.createEl("h3", { text: "Christopher AI" });

		this.emptyStateEl.createEl("p", {
			text: "Pregúntame algo de tus notas, bugs, decisiones, proyectos o ideas perdidas en el vault."
		});

		const modelRow = this.emptyStateEl.createDiv("brain-chat-empty-model-row");
		modelRow.createSpan({ text: "Modelo:" });

		const modelSelect = modelRow.createEl("select", {
			cls: "brain-chat-empty-model-select"
		});

		modelSelect.createEl("option", {
			text: this.plugin.settings.chatModel,
			value: this.plugin.settings.chatModel
		});

		try {
			const installedModels = await this.plugin.fetchInstalledModels();
			modelSelect.empty();

			for (const modelName of installedModels) {
				modelSelect.createEl("option", {
					text: modelName,
					value: modelName
				});
			}

			if (!installedModels.includes(this.plugin.settings.chatModel)) {
				modelSelect.createEl("option", {
					text: `${this.plugin.settings.chatModel} — no detectado`,
					value: this.plugin.settings.chatModel
				});
			}

			modelSelect.value = this.plugin.settings.chatModel;

			modelSelect.onchange = async () => {
				this.plugin.settings.chatModel = modelSelect.value;
				await this.plugin.saveSettings();
			};
		} catch {
			modelSelect.disabled = true;
			const setupButton = modelRow.createEl("button", {
				text: "Instalar ollama",
				cls: "brain-chat-empty-setup-button"
			});

			setupButton.onclick = () => {
				void this.plugin.openOllamaDownload();
			};
		}
	}

	async submitPrompt() {
		const question = this.inputEl.value.trim();

		if (!question) {
			new Notice("Escribe una pregunta primero.");
			return;
		}

		this.inputEl.value = "";
		this.autoResizeInput();
		this.inputEl.placeholder = randomPromptHint();

		await this.askBrain(question);
	}

	async askBrain(question: string) {
		this.abortController = new AbortController();
		this.setThinking(true);

		await this.addMessage("user", question);
		this.showLoadingBubble();

		try {
			const ownerContext = await this.getOwnerContext();

			const context = await this.buildBrainContext(question);

			const answer = await this.askOllama(

				question,
				ownerContext,
				context,
				this.abortController.signal

			);

			this.removeLoadingBubble();
			await this.addMessage("assistant", answer);
		} catch (error) {
			this.removeLoadingBubble();

			if (error instanceof DOMException && error.name === "AbortError") {
				await this.addMessage("assistant", "Cancelado.");
				return;
			}

			console.error("Christopher AI failed:", error);

			const message = error instanceof Error
				? `${error.name}: ${error.message}`
				: String(error);

			await this.addMessage("assistant", `Algo falló:\n\n${message}`);
		} finally {
			this.abortController = null;
			this.setThinking(false);
		}
	}

	stopCurrentRequest() {
		if (this.abortController) this.abortController.abort();
	}

	setThinking(isThinking: boolean) {
		if (!this.sendButtonEl || !this.stopButtonEl) return;

		this.sendButtonEl.disabled = isThinking;
		this.stopButtonEl.disabled = !isThinking;
		this.stopButtonEl.toggleClass("is-active", isThinking);
	}

	async buildBrainContext(question: string): Promise<string> {
		const files = this.app.vault.getMarkdownFiles();
		const currentFile = this.getCurrentFile();
		const terms = extractQueryTerms(question);

		const metadataCandidates = this.collectMetadataCandidates(files, terms, currentFile);

		let selectedCandidates = metadataCandidates
			.sort((a, b) => b.score - a.score)
			.slice(0, this.plugin.settings.maxNotes);

		if (selectedCandidates.length < Math.min(4, this.plugin.settings.maxNotes)) {
			const contentCandidates = await this.collectContentCandidates(
				files,
				terms,
				currentFile,
				new Set(selectedCandidates.map((candidate) => candidate.file.path))
			);

			selectedCandidates = selectedCandidates
				.concat(contentCandidates)
				.sort((a, b) => b.score - a.score)
				.slice(0, this.plugin.settings.maxNotes);
		}

		const graphExpanded = this.expandCandidatesByGraphAndTags(selectedCandidates, files);

		const finalCandidates = selectedCandidates
			.concat(graphExpanded)
			.sort((a, b) => b.score - a.score);

		const uniqueCandidates = new Map<string, BrainCandidate>();

		for (const candidate of finalCandidates) {
			if (!uniqueCandidates.has(candidate.file.path)) {
				uniqueCandidates.set(candidate.file.path, candidate);
			}
		}

		const candidates = Array.from(uniqueCandidates.values()).slice(
			0,
			this.plugin.settings.maxNotes + 4
		);

		if (candidates.length === 0) {
			return "No encontré notas relacionadas directamente con la pregunta.";
		}

		const contextParts: string[] = [];

		for (const candidate of candidates) {
			const content = await this.app.vault.cachedRead(candidate.file);
			const clipped = content.slice(0, this.plugin.settings.maxCharsPerNote);
			const tags = candidate.tags.length > 0
				? candidate.tags.map((tag) => `#${tag}`).join(", ")
				: "sin tags";
			const properties = Object.entries(candidate.properties)
				.map(([key, value]) => `${key}: ${humanizePropertyValue(value)}`)
				.filter((line) => !line.endsWith(": "))
				.join("; ");

			contextParts.push([
				`SOURCE: ${candidate.file.path}`,
				`TITLE: ${candidate.title}`,
				`MODIFIED: ${formatModifiedDate(candidate.file)}`,
				`REASON: ${candidate.reason}`,
				`METADATA_SCORE: ${candidate.metadataScore}`,
				`TAGS: ${tags}`,
				`PROPERTIES: ${properties || "sin propiedades"}`,
				"CONTENT:",
				clipped
			].join("\n"));
		}

		return contextParts.join("\n\n---\n\n");
	}

	collectMetadataCandidates(
		files: TFile[],
		terms: string[],
		currentFile: TFile | null
	): BrainCandidate[] {
		const candidates: BrainCandidate[] = [];
		const currentTags = currentFile ? this.getTagsForFile(currentFile) : [];
		const currentTagSet = new Set(currentTags.map(normalizeToken));
		const currentProperties = currentFile ? this.getPropertiesForFile(currentFile) : {};
		const currentProject = normalizeToken(humanizePropertyValue(currentProperties.project));
		const currentArea = normalizeToken(humanizePropertyValue(currentProperties.area));
		const resolvedLinks = this.app.metadataCache.resolvedLinks;
		const currentOutgoingLinks = currentFile ? Object.keys(resolvedLinks[currentFile.path] ?? {}) : [];

		for (const file of files) {
			if (this.shouldIgnoreFile(file)) continue;

			const tags = this.getTagsForFile(file);
			const normalizedTags = tags.map(normalizeToken);
			const properties = this.getPropertiesForFile(file);
			const title = this.getTitleForFile(file);
			const propertyEntries = Object.entries(properties);
			const propertySearchText = propertyEntries
				.map(([key, value]) => `${key} ${humanizePropertyValue(value)}`)
				.join(" ");
			const normalizedPath = normalizeToken(file.path);

			let score = 0;
			let metadataScore = 0;
			const reasons: string[] = [];
			const freshnessScore = recencyScore(file);

			if (freshnessScore > 0) {
				score += freshnessScore;
				reasons.push(`fresh:${freshnessScore}`);
			}

			for (const term of terms) {
				for (const tag of normalizedTags) {
					const tagScore = scoreTermAgainstValue(term, tag, 24, 16);

					if (tagScore > 0) {
						score += tagScore;
						metadataScore += tagScore;
						reasons.push(`tag:${tag}`);
					}
				}

				const propertyScore = scoreTermAgainstValue(term, propertySearchText, 18, 11);

				if (propertyScore > 0) {
					score += propertyScore;
					metadataScore += propertyScore;
					reasons.push(`property:${term}`);
				}

				const titleScore = scoreTermAgainstValue(term, title, 14, 9);

				if (titleScore > 0) {
					score += titleScore;
					metadataScore += titleScore;
					reasons.push(`title:${term}`);
				}

				const pathScore = scoreTermAgainstValue(term, normalizedPath, 5, 3);

				if (pathScore > 0) {
					score += pathScore;
					reasons.push(`path:${term}`);
				}
			}

			for (const tag of normalizedTags) {
				if (currentTagSet.has(tag)) {
					score += 8;
					metadataScore += 8;
					reasons.push(`same-tag-as-current:${tag}`);
				}
			}

			const fileProject = normalizeToken(humanizePropertyValue(properties.project));
			const fileArea = normalizeToken(humanizePropertyValue(properties.area));

			if (currentProject && fileProject && currentProject === fileProject) {
				score += 12;
				metadataScore += 12;
				reasons.push(`same-project:${fileProject}`);
			}

			if (currentArea && fileArea && currentArea === fileArea) {
				score += 6;
				metadataScore += 6;
				reasons.push(`same-area:${fileArea}`);
			}

			if (currentFile && file.path === currentFile.path) {
				score += 18;
				metadataScore += 18;
				reasons.push("current-note");
			}

			if (currentFile && currentOutgoingLinks.includes(file.path)) {
				score += 10;
				metadataScore += 10;
				reasons.push("linked-from-current");
			}

			if (currentFile && resolvedLinks[file.path]?.[currentFile.path]) {
				score += 10;
				metadataScore += 10;
				reasons.push("backlinks-current");
			}

			const hasMetadataRelevance = score > freshnessScore;

			if (hasMetadataRelevance || (terms.length === 0 && score > 0)) {
				candidates.push({
					file,
					score,
					tags,
					properties,
					title,
					metadataScore,
					reason: Array.from(new Set(reasons)).join(", ")
				});
			}
		}

		return candidates;
	}

	async collectContentCandidates(
		files: TFile[],
		terms: string[],
		currentFile: TFile | null,
		alreadySelected: Set<string>
	): Promise<BrainCandidate[]> {
		const candidates: BrainCandidate[] = [];

		for (const file of files) {
			if (this.shouldIgnoreFile(file)) continue;
			if (alreadySelected.has(file.path)) continue;

			const content = await this.app.vault.cachedRead(file);
			const haystack = normalizeToken(`${file.path}\n${content}`);

			let score = 0;
			const reasons: string[] = [];

			for (const term of terms) {
				if (haystack.includes(term)) {
					score += 1;
					reasons.push(`content:${term}`);
				}
			}

			if (currentFile && file.path === currentFile.path) {
				score += 10;
				reasons.push("current-note");
			}

			if (score > 0) {
				const tags = this.getTagsForFile(file);
				const properties = this.getPropertiesForFile(file);

				candidates.push({
					file,
					score,
					tags,
					properties,
					title: this.getTitleForFile(file),
					metadataScore: 0,
					reason: reasons.join(", ")
				});
			}
		}

		return candidates;
	}

	expandCandidatesByGraphAndTags(candidates: BrainCandidate[], files: TFile[]): BrainCandidate[] {
		const expanded: BrainCandidate[] = [];
		const fileMap = new Map(files.map((file) => [file.path, file]));
		const selectedPaths = new Set(candidates.map((candidate) => candidate.file.path));
		const seedTags = new Set<string>();

		for (const candidate of candidates) {
			for (const tag of candidate.tags) seedTags.add(normalizeToken(tag));
		}

		const resolvedLinks = this.app.metadataCache.resolvedLinks;

		for (const candidate of candidates) {
			const outgoingLinks = resolvedLinks[candidate.file.path] ?? {};

			for (const linkedPath of Object.keys(outgoingLinks)) {
				if (selectedPaths.has(linkedPath)) continue;

				const linkedFile = fileMap.get(linkedPath);

				if (linkedFile && !this.shouldIgnoreFile(linkedFile)) {
					const tags = this.getTagsForFile(linkedFile);
					const properties = this.getPropertiesForFile(linkedFile);

					expanded.push({
						file: linkedFile,
						score: candidate.score - 2,
						tags,
						properties,
						title: this.getTitleForFile(linkedFile),
						metadataScore: Math.max(candidate.metadataScore - 2, 0),
						reason: `linked-from:${candidate.file.path}`
					});
				}
			}

			for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
				if (!links[candidate.file.path]) continue;
				if (selectedPaths.has(sourcePath)) continue;

				const backlinkFile = fileMap.get(sourcePath);

				if (backlinkFile && !this.shouldIgnoreFile(backlinkFile)) {
					const tags = this.getTagsForFile(backlinkFile);
					const properties = this.getPropertiesForFile(backlinkFile);

					expanded.push({
						file: backlinkFile,
						score: candidate.score - 2,
						tags,
						properties,
						title: this.getTitleForFile(backlinkFile),
						metadataScore: Math.max(candidate.metadataScore - 2, 0),
						reason: `backlink-to:${candidate.file.path}`
					});
				}
			}
		}

		for (const file of files) {
			if (this.shouldIgnoreFile(file)) continue;
			if (selectedPaths.has(file.path)) continue;

			const tags = this.getTagsForFile(file);
			const hasSharedTag = tags.map(normalizeToken).some((tag) => seedTags.has(tag));

			if (hasSharedTag) {
				const properties = this.getPropertiesForFile(file);

				expanded.push({
					file,
					score: 7,
					tags,
					properties,
					title: this.getTitleForFile(file),
					metadataScore: 7,
					reason: "same-tag-graph"
				});
			}
		}

		return expanded;
	}

	getTagsForFile(file: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(file);
		const tags = new Set<string>();

		for (const tag of cache?.tags ?? []) {
			tags.add(normalizeTag(tag.tag));
		}

		const frontmatter = this.getPropertiesForFile(file);
		const frontmatterTags: unknown = frontmatter.tags;

		if (Array.isArray(frontmatterTags)) {
			for (const tag of frontmatterTags) {
				tags.add(normalizeTag(String(tag)));
			}
		}

		if (typeof frontmatterTags === "string") {
			for (const tag of frontmatterTags.split(/[,\s]+/)) {
				if (tag.trim()) tags.add(normalizeTag(tag));
			}
		}

		return Array.from(tags).filter(Boolean);
	}

	getPropertiesForFile(file: TFile): Record<string, unknown> {
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter: unknown = cache?.frontmatter;

		if (!frontmatter || typeof frontmatter !== "object") {
			return {};
		}

		return frontmatter as Record<string, unknown>;
	}

	getTitleForFile(file: TFile): string {
		return getHeadingTitleFromCache(file, this.app);
	}

	async askOllama(
		question: string,
		ownerContext: string,
		context: string,
		signal: AbortSignal
	): Promise<string> {
		const systemPrompt = `
You are Christopher AI, a local AI companion inside an Obsidian vault.

Vault owner context:

${ownerContext}

Use this context to understand who the vault belongs to, how to address the user, and how to interpret personal notes. Do not reveal private owner details unless directly relevant to the user's question.

Personality:
- Speak naturally and directly.
- Never say "based on your files", "based on your notes", "based on the available context", or similar filler.
- The user already knows the answer comes from the vault.
- If you found something in the notes, say it as a direct answer.
- If there is not enough context, say it clearly without sounding robotic.
- Be objective: distinguish facts found in notes from reasonable inference.
- Be useful: when the answer is practical, include a concrete improvement, risk, or recommendation.

Rules:
- Answer in the same language as the user.
- Use the notes context first, then general knowledge only to improve usefulness.
- Retrieval priority is: tags and frontmatter properties first; H1 titles second; graph links and backlinks third; folder path fourth; full content last.
- Folder structure can improve retrieval, but never assume every user follows the same folder structure.
- You may use general knowledge when helpful.
- Do not invent notes, paths, decisions, or sources.
- When citing a note, use this exact format: [[path/to/note.md]]
- Prefer concise, direct answers with bullet points when useful.
- If the topic allows it, end with a small "Mejora sugerida" or "Siguiente paso" section.
`.trim();

		const userPrompt = `
Question:
${question}

Vault context:
${context}
`.trim();

		const baseUrl = normalizeBaseUrl(this.plugin.settings.ollamaBaseUrl);

		if (signal.aborted) throw new DOMException("Request aborted.", "AbortError");

		const response = await requestUrl({
			url: `${baseUrl}/api/chat`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			throw: false,
			body: JSON.stringify({
				model: this.plugin.settings.chatModel,
				stream: false,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt }
				]
			})
		});

		if (signal.aborted) throw new DOMException("Request aborted.", "AbortError");

		if (response.status < 200 || response.status >= 300) {
			throw new Error(`Ollama HTTP ${response.status}: ${response.text}`);
		}

		const json = response.json as OllamaChatResponse;
		return json.message?.content ?? "Ollama no regresó respuesta.";
	}

	getCurrentFile(): TFile | null {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		return markdownView?.file ?? null;
	}

	shouldIgnoreFile(file: TFile): boolean {
		const configDir = `${this.app.vault.configDir}/`;
		const ignoredPrefixes = [
			configDir,
			"node_modules/",
			".git/",
			"Templates/",
			"templates/"
		];
		return ignoredPrefixes.some((prefix) => file.path.startsWith(prefix));
	}

	async addMessage(role: "user" | "assistant", text: string) {
		this.emptyStateEl?.remove();

		const message = this.messagesEl.createDiv();
		message.addClasses(["brain-chat-message", role]);

		const bubble = message.createDiv();
		bubble.addClass("brain-chat-bubble");

		if (text.length > MAX_COMPACT_MESSAGE_LENGTH) {
			const preview = `${text.slice(0, MAX_COMPACT_MESSAGE_LENGTH).trim()}... `;
			bubble.createSpan({ text: preview });

			const link = bubble.createEl("a", {
				text: "Ver más",
				cls: "brain-chat-see-more"
			});

			link.onclick = (event) => {
				event.preventDefault();
				new FullMessageModal(
					this.app,
					text,
					this.getCurrentFile()?.path ?? ""
				).open();
			};
		} else {
			await MarkdownRenderer.render(
				this.app,
				text,
				bubble,
				this.getCurrentFile()?.path ?? "",
				this
			);

			wireBrainLinks(this.app, bubble, this.getCurrentFile()?.path ?? "");
		}

		this.scrollToBottom();
	}

	showLoadingBubble() {
		this.removeLoadingBubble();

		const message = this.messagesEl.createDiv();
		message.addClasses(["brain-chat-message", "assistant", "brain-chat-is-loading"]);

		const bubble = message.createDiv();
		bubble.addClasses(["brain-chat-bubble", "brain-chat-loading-bubble"]);

		const dots = bubble.createDiv();
		dots.addClass("brain-chat-loading-dots");
		dots.createSpan();
		dots.createSpan();
		dots.createSpan();

		this.loadingBubbleEl = message;
		this.scrollToBottom();
	}

	removeLoadingBubble() {
		if (this.loadingBubbleEl) {
			this.loadingBubbleEl.remove();
			this.loadingBubbleEl = null;
		}
	}

	scrollToBottom() {
		window.requestAnimationFrame(() => {
			this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
		});
	}

	autoResizeInput() {
		this.inputEl.setCssProps({ "--brain-chat-input-height": "auto" });
		this.inputEl.setCssProps({
			"--brain-chat-input-height": `${Math.min(this.inputEl.scrollHeight, 140)}px`
		});
	}
}

class FullMessageModal extends Modal {
	private markdownComponent = new Component();
	private message: string;
	private sourcePath: string;

	constructor(app: App, message: string, sourcePath: string) {
		super(app);
		this.message = message;
		this.sourcePath = sourcePath;
	}

	async onOpen() {
		const { contentEl } = this;
		this.markdownComponent.load();

		contentEl.empty();
		contentEl.addClass("brain-chat-modal");

		contentEl.createEl("h2", { text: "Respuesta completa" });

		const body = contentEl.createDiv("brain-chat-modal-body");

		await MarkdownRenderer.render(
			this.app,
			this.message,
			body,
			this.sourcePath,
			this.markdownComponent
		);

		wireBrainLinks(this.app, body, this.sourcePath);
	}

	onClose() {
		this.markdownComponent.unload();
		this.contentEl.empty();
	}
}

class BrainChatSettingTab extends PluginSettingTab {
	plugin: ChristopherAIPlugin;

	constructor(app: App, plugin: ChristopherAIPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Ollama base URL")
			.setDesc("Use the default local server unless you changed ollama.")
			.addText((text) =>
				text
					.setPlaceholder("Local server URL")
					.setValue(this.plugin.settings.ollamaBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.ollamaBaseUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		const modelSection = containerEl.createDiv();
		void this.renderModelSelector(modelSection);

		new Setting(containerEl)
			.setName("Max notes")
			.setDesc("How many notes to send as context.")
			.addSlider((slider) =>
				slider
					.setLimits(3, 20, 1)
					.setValue(this.plugin.settings.maxNotes)
					.onChange(async (value) => {
						this.plugin.settings.maxNotes = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Max chars per note")
			.setDesc("Maximum text to take from each note.")
			.addSlider((slider) =>
				slider
					.setLimits(500, 5000, 100)
					.setValue(this.plugin.settings.maxCharsPerNote)
					.onChange(async (value) => {
						this.plugin.settings.maxCharsPerNote = value;
						await this.plugin.saveSettings();
					})
			);
	}


	async renderModelSelector(containerEl: HTMLElement) {
		containerEl.empty();

		new Setting(containerEl)
			.setName("Chat model")
			.setHeading();

		containerEl.createEl("p", { text: "Christopher AI reads the models already installed in ollama." });

		const statusEl = containerEl.createEl("p", { text: "Loading models from ollama..." });

		try {
			const installedModels = await this.plugin.fetchInstalledModels();

			statusEl.remove();

			if (installedModels.length > 0) {
				const hasRecommendedModel = installedModels.includes(RECOMMENDED_DEFAULT_MODEL);

				new Setting(containerEl)
					.setName("Chat model")
					.setDesc("Choose one of your installed ollama models.")
					.addDropdown((dropdown) => {
						for (const modelName of installedModels) {
							dropdown.addOption(modelName, modelName);
						}

						if (!installedModels.includes(this.plugin.settings.chatModel)) {
							dropdown.addOption(
								this.plugin.settings.chatModel,
								`${this.plugin.settings.chatModel} — not installed or not detected`
							);
						}

						dropdown
							.setValue(this.plugin.settings.chatModel)
							.onChange(async (value) => {
								this.plugin.settings.chatModel = value;
								await this.plugin.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName("Refresh list")
					.setDesc("Read installed models from ollama again.")
					.addButton((button) =>
						button
							.setButtonText("Refresh")
							.onClick(() => {
								void this.renderModelSelector(containerEl);
							})
					);

				if (!hasRecommendedModel) {
					new Setting(containerEl)
						.setName(`Install recommended model: ${RECOMMENDED_DEFAULT_MODEL}`)
						.setDesc(`Recommended default for fast local vault search and note analysis. Run: ollama pull ${RECOMMENDED_DEFAULT_MODEL}`)
						.addButton((button) =>
							button
								.setButtonText("Use model")
								.onClick(() => {
									void this.useModelFromSettings(containerEl, RECOMMENDED_DEFAULT_MODEL);
								})
						);
				}

				return;
			}

			this.renderNoModelsInstalled(containerEl);
		} catch (error) {
			statusEl.setText("Could not connect to ollama.");

			const message = error instanceof Error ? error.message : String(error);
			containerEl.createEl("pre", { text: message });

			this.renderOllamaInstallHelp(containerEl);
			this.renderRecommendedModels(containerEl);
		}
	}

	renderNoModelsInstalled(containerEl: HTMLElement) {
		containerEl.createEl("p", {
			text: "No installed models were found in ollama. Install a lightweight one to get started."
		});

		new Setting(containerEl)
			.setName(`Install recommended model: ${RECOMMENDED_DEFAULT_MODEL}`)
			.setDesc("Runs: ollama pull gemma4:e4b")
			.addButton((button) =>
				button
					.setButtonText("Use model")
					.onClick(() => {
						void this.useModelFromSettings(containerEl, RECOMMENDED_DEFAULT_MODEL);
					})
			);

		this.renderRecommendedModels(containerEl);
	}

	renderRecommendedModels(containerEl: HTMLElement) {
		new Setting(containerEl)
			.setName("Recommended lightweight models")
			.setHeading();

		for (const model of RECOMMENDED_LIGHT_MODELS) {
			const command = `ollama pull ${model.name}`;

			new Setting(containerEl)
				.setName(model.name)
				.setDesc(`${model.reason} Command: ${command}`)
				.addButton((button) =>
					button
						.setButtonText("Use model name")
						.onClick(() => {
							void this.useModelFromSettings(containerEl, model.name);
						})
				);
		}
	}

	renderOllamaInstallHelp(containerEl: HTMLElement) {
		new Setting(containerEl)
			.setName("Install ollama")
			.setDesc("Open the official ollama download page. After installing, start ollama and return here.")
			.addButton((button) =>
				button
					.setButtonText("Open download")
					.onClick(() => {
						void this.plugin.openOllamaDownload();
					})
			);
	}

	async useModelFromSettings(containerEl: HTMLElement, modelName: string) {
		this.plugin.settings.chatModel = modelName;
		await this.plugin.saveSettings();
		new Notice(`Model set to ${modelName}. Install it with: ollama pull ${modelName}`);
		await this.renderModelSelector(containerEl);
	}
}
