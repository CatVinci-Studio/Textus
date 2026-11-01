# Documentation

Start with [CONTRIBUTING.md](../CONTRIBUTING.md): setup, the checks to run,
branches, commits and the writing rules. [AGENTS.md](../AGENTS.md) condenses
the same rules for AI coding assistants; [ROADMAP.md](../ROADMAP.md) shows
where the project is heading.

## Developing (`dev/`)

| Document                                            | What it covers                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [architecture.md](dev/architecture.md)              | The folders in `src/` and `src-tauri/`, their layers and import direction (ESLint checks it), CSS |
| [testing.md](dev/testing.md)                        | Each test suite: what it covers, how to run it, and what is deliberately not covered              |
| [local-builds.md](dev/local-builds.md)              | Faster builds across many worktrees (a shared Cargo build directory) and `npm run check:quick`    |
| [storage.md](dev/storage.md)                        | Every file the app writes (settings, UI state, history), per platform                             |
| [lifecycle.md](dev/lifecycle.md)                    | Launching, closing and quitting, background mode and its tray, updates, and what a windowless process costs |
| [saving.md](dev/saving.md)                          | What a save writes to a Markdown file: unedited blocks as written, edited ones serialized         |
| [translating.md](dev/translating.md)                | The ten UI languages: which files a translation fills, tone, and how it is checked                |
| [releasing.md](dev/releasing.md)                    | Branches, tags, the desktop release, pre-releases, the updater manifest                           |
| [infrastructure.md](dev/infrastructure.md) | The other repositories, the automation, the website and downloads, the secrets and how to replace them |
| [ios-release.md](dev/ios-release.md)                | Shipping the iOS app: App Store Connect setup, keys, TestFlight, review                           |
| [ios-code-map.md](dev/ios-code-map.md)              | What the desktop and iOS apps share and what is desktop-only; building on a Mac                   |
| [windows-installer.md](dev/windows-installer.md)    | The NSIS installer, and why there is no MSI                                                       |
| [webview-support.md](dev/webview-support.md)        | The oldest web engines supported (WebView2 on Chromium 105), what broke below, the check that guards it |
| [writing-plugins.md](dev/writing-plugins.md)        | Writing a plugin: the manifest, the API, webviews, testing and publishing to the market          |
| [plugin-reference.md](dev/plugin-reference.md)      | The plugin API, every call and type (made from [textus.d.ts](dev/textus.d.ts))                    |
| [plugin-api.md](dev/plugin-api.md)                  | Inside the app: the registries plugins and built-in features add to                               |

## Design (`design/`)

| Document                                         | What it covers                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [design-language.md](design/design-language.md)  | The design standard: tokens, colour, type, layout, shape, motion, components, themes, plugins |
| [plugins.md](design/plugins.md)                  | The plugin system and the market: what is built, and why                                |
| [ai-agent.md](design/ai-agent.md)                | One AI request from start to end: providers, the agent loop, tools, rules for every model |
| [ai-concepts.md](design/ai-concepts.md)          | The AI concepts: project folder, style profile, library, writing rules, skills, priority |
| [ai-proposals.md](design/ai-proposals.md)        | An AI edit's life from streaming to the document, and the three chat surfaces            |
| [ai-eval.md](design/ai-eval.md)                  | Evaluating the AI features against real providers                                       |

## Other

- [releases/](releases/) - release notes, one file per version, in the
  outline of [releases/TEMPLATE.md](releases/TEMPLATE.md). The release workflow uses
  them as the GitHub release's text. Unreleased notes are fragments in
  [releases/next/](releases/next/README.md), one per pull request.
- [images/](images/) - README and App Store screenshots
  (`npm run screenshots:readme` regenerates the README's).
- [archive/](archive/) - records that are no longer updated (some in Chinese).
