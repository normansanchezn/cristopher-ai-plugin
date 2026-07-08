# Christopher AI

Christopher AI is a local AI assistant for Obsidian.

It helps you ask questions about your vault using your notes, tags, properties, titles, links, backlinks, and content. It is designed to work with Ollama, so your notes can stay on your machine.

The goal is simple: turn your vault into a useful brain, not just a folder full of files.

## What It Does

- Answers questions using your Obsidian notes.
- Finds better context through tags, properties, titles, and graph links.
- Reads full note content only after finding the most relevant candidates.
- Works best with local Ollama models.
- Helps install or select the recommended model: `gemma4:e4b`.
- Avoids filler phrases like "based on your files".
- Gives direct answers, practical advice, and improvement suggestions when useful.

## Install In Obsidian

When Christopher AI is available in the Obsidian community plugin store:

1. Open Obsidian.
2. Go to `Settings`.
3. Go to `Community plugins`.
4. Turn off `Restricted mode` if needed.
5. Click `Browse`.
6. Search for `Christopher AI`.
7. Click `Install`.
8. Click `Enable`.
9. Open Christopher AI from the ribbon icon or command palette.

Then open the plugin settings and check Ollama.

## Ollama Setup

Christopher AI uses Ollama for local AI.

Recommended default model:

```bash
gemma4:e4b
```

If Ollama is not installed, Christopher AI will show an install option in settings. If Ollama is installed but the model is missing, Christopher AI can run:

```bash
ollama pull gemma4:e4b
```

You can also use another installed Ollama model, but `gemma4:e4b` is the recommended minimum for balanced local note search.

## How Search Works

Christopher AI does not just scan every file from top to bottom.

It searches in this order:

1. Tags and frontmatter properties.
2. H1 titles.
3. Graph links and backlinks.
4. Folder path as a secondary clue.
5. Full note content.

This makes search faster and usually more accurate.

You do not need to follow one exact folder structure. But if your vault is organized, Christopher AI will find the right notes faster.

## Recommended Vault Structure

This structure is optional, but strongly recommended:

```text
00 - Home/
01 - Identity/
02 - Areas/
03 - Projects/
04 - Work/
05 - Learning/
06 - Resources/
99 - Archive/
```

### What Each Folder Is For

`00 - Home`
: Maps, dashboards, and entry points.

`01 - Identity`
: Personal profile, preferences, context, and long-term identity notes.

`02 - Areas`
: Ongoing life areas like finance, health, habits, family, credentials, or responsibilities.

`03 - Projects`
: Anything with a goal, deliverable, deadline, or active development.

`04 - Work`
: Job notes, company context, processes, reviews, sprint notes, client knowledge.

`05 - Learning`
: Courses, study notes, classes, summaries, flashcards.

`06 - Resources`
: Reusable references, templates, scripts, guides, prompts, and technical notes.

`99 - Archive`
: Old, unclear, inactive, or pending-review material.

## Templates

Put your templates inside:

```text
06 - Resources/Templates/
```

Recommended templates:

```text
06 - Resources/Templates/Area.md
06 - Resources/Templates/Project.md
06 - Resources/Templates/Requirement.md
06 - Resources/Templates/Bug.md
06 - Resources/Templates/Learning.md
06 - Resources/Templates/Resource.md
06 - Resources/Templates/Credential.md
06 - Resources/Templates/Archive.md
```

Recommended H1 title format:

```md
# [Type] Project or Area - Real topic
```

Examples:

```md
# [Project] OpenClaw - Ollama and Tailscale
# [Requirement] ProfessorKit Web - Weekly calendar
# [Bug] CitaCero - Signup validation
# [Learning] Docker - Container basics
# [Resource] GitHub - Personal access token
```

Recommended frontmatter:

```md
---
tags:
  - area/projects
  - project/example
  - type/requirement
  - topic/ai
area: "Projects"
project: "Example"
status: active
---
```

Good tags make Christopher AI much faster.

## Recommended Tags

Use a few clear tag families:

```text
area/*
project/*
topic/*
type/*
status/*
security/*
org/*
```

Examples:

```text
area/projects
project/openclaw
topic/ollama
type/bug
status/review
security/sensitive
org/accenture
```

Do not over-tag. A note with 3 to 6 good tags is usually better than a note with 20 weak tags.

## Expected Accuracy

These numbers are estimates, not guarantees. Accuracy depends on note quality, model quality, and how specific your question is.

| Vault condition | Expected success | Expected error | What happens |
|---|---:|---:|---|
| Unorganized vault, weak titles, few tags | 55-70% | 30-45% | Christopher can still search content, but may pick similar or outdated notes. |
| Some folders, decent titles, few tags | 70-82% | 18-30% | Results improve because titles and paths give useful clues. |
| Organized folders, clear H1 titles, useful tags | 82-92% | 8-18% | Most answers should use the right notes quickly. |
| Organized vault with tags, properties, links, and updated notes | 90-96% | 4-10% | Best case. Christopher can jump through metadata and graph links before reading full content. |

### Why Errors Happen

Errors usually come from:

- Missing tags.
- Generic titles like `Untitled` or `Notes`.
- Old notes that contradict newer notes.
- Similar projects with similar names.
- Very broad questions.
- A small local model with limited reasoning.

### How To Improve Results

- Use one clear H1 per note.
- Add tags like `project/*`, `type/*`, and `topic/*`.
- Add frontmatter properties like `project`, `area`, and `status`.
- Link related notes with Obsidian links.
- Archive old notes instead of leaving them mixed with active notes.
- Ask specific questions.

## Good Questions

Better:

```text
What is the current Ollama setup for OpenClaw?
```

Weaker:

```text
What did I do with AI?
```

Better:

```text
Summarize the active bugs for CitaCero signup and suggest the next fix.
```

Weaker:

```text
What bugs do I have?
```

## Privacy

Christopher AI is designed for local-first use with Ollama.

Your notes are sent to your configured Ollama endpoint. If your Ollama endpoint is local, your note context stays on your machine. If you configure a remote Ollama server, your note context is sent to that server.

## Best Result Formula

For each important note:

```md
---
tags:
  - area/projects
  - project/my-project
  - type/requirement
  - topic/web
area: "Projects"
project: "My Project"
status: active
---
# [Requirement] My Project - Real feature name
```

That is enough for Christopher AI to find it quickly and answer more objectively.

