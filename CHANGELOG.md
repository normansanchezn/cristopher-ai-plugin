# Changelog

## 0.1.0

Initial community release of Christopher AI.

### Added

- Local AI chat view powered by Ollama.
- Metadata-first vault retrieval using tags, frontmatter properties, note titles, graph links, backlinks, folder paths, and note content.
- Settings for Ollama URL, chat model, maximum notes, and maximum characters per note.
- Ollama model discovery from the local Ollama server.
- Guided setup for installing Ollama and selecting a recommended local model.

### Changed

- Aligned the plugin manifest with community plugin requirements.
- Raised the minimum app version to match the APIs used by the plugin.
- Replaced browser `fetch` calls with Obsidian `requestUrl`.
- Removed direct shell execution for safer community review.
- Removed clipboard access from the full-message modal.
- Updated CSS to avoid `!important` and broad reset styles.

### Fixed

- Avoided detaching workspace leaves during plugin unload.
- Cleaned up async handlers to avoid unhandled promises.
- Avoided using the main plugin instance as a long-lived markdown render component.
