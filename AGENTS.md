# Christopher AI Development Notes

Christopher AI is an Obsidian community plugin written in TypeScript and bundled with esbuild.

## Commands

```bash
npm install
npm run dev
npm run build
```

## Release Artifacts

GitHub releases should include:

- `main.js`
- `manifest.json`
- `styles.css`

## Project Rules

- Keep user data local by default.
- Do not add telemetry.
- Do not send vault content to cloud services.
- Ollama is the default model provider.
- Retrieval should prioritize metadata first: tags, frontmatter properties, H1 titles, graph links/backlinks, then full note content.
- Keep `manifest.json` version, `package.json` version, and `versions.json` aligned.

