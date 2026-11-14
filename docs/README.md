# Documentation

Start with [CONTRIBUTING.md](../CONTRIBUTING.md): where to start, setup,
the one check to run and how pull requests work. [AGENTS.md](../AGENTS.md) is the
index and hard rules for AI coding assistants; [ROADMAP.md](../ROADMAP.md)
shows where the project is heading.

## Developing (`dev/`)

Start here:

| Document                                 | What it covers                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [architecture.md](dev/architecture.md)   | The folders in `src/` and `src-tauri/`, the layers ESLint enforces, UI layering, the backend bridge, CSS, the CSP |
| [recipes.md](dev/recipes.md)             | Step by step: a setting, a menu item and shortcut, a backend command, a UI string, a plugin API call, an e2e test, platform code |
| [code-style.md](dev/code-style.md)       | The code-shape, interface and writing rules, and the script that checks each                            |
| [triage.md](dev/triage.md)               | Sorting issues and pull requests, and how a newcomer issue is written                                  |
| [reuse.md](dev/reuse.md)                 | The one place in the code for each common need                                                         |
| [testing.md](dev/testing.md)             | Which test layer, running each suite, the e2e helpers, CI's jobs, flaky tests, what isn't covered      |
| [local-builds.md](dev/local-builds.md)   | Faster builds across many worktrees, `npm run check:quick`, installers, the browser playground         |

How the app works:

| Document                                           | What it covers                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [documents.md](dev/documents.md)                   | Tabs, the opening rule, saving, Save Automatically, drafts, outside changes, closing                         |
| [markdown-roundtrip.md](dev/markdown-roundtrip.md) | What a save writes to a Markdown file: unedited blocks as written, edited ones serialized; the round-trip test |
| [storage.md](dev/storage.md)                       | Every file the app writes (settings, UI state, histories, plugins, drafts), per platform                     |
| [lifecycle.md](dev/lifecycle.md)                   | Launching, closing and quitting, background mode and its tray, scheduled jobs, updates, what a windowless process costs |
| [cli.md](dev/cli.md)                               | The `textus` command: how a command line is read, what runs without the app, the app connection             |
| [plugin-api.md](dev/plugin-api.md)                 | Inside the app: the registries plugins and built-in features add to                                        |

Platforms:

| Document                                         | What it covers                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [ios-code-map.md](dev/ios-code-map.md)           | What the desktop and iOS apps share and what is desktop-only; the iPhone layout; building on a Mac |
| [webview-support.md](dev/webview-support.md)     | The oldest web engines supported (WebView2 on Chromium 105), what broke below, the check that guards it |
| [windows-installer.md](dev/windows-installer.md) | The NSIS installer, and why there is no MSI                                                       |
| [translating.md](dev/translating.md)             | The ten UI languages: the files of one language, tone, and how it is checked                      |

Shipping and the project:

| Document                                     | What it covers                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [releasing.md](dev/releasing.md)             | Branches, pull requests and commit messages; test builds and releases; installers; update channels; the updater manifest |
| [ios-release.md](dev/ios-release.md)         | Shipping the iOS app: App Store Connect setup, keys, TestFlight, review, the China App Store      |
| [infrastructure.md](dev/infrastructure.md)   | The other repositories, the automation, the website and downloads, the secrets and how to replace them |
| [roles.md](dev/roles.md)                     | Who can do what on GitHub, and the branch protection                                              |

Writing plugins:

| Document                                         | What it covers                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [plugins/](dev/plugins/README.md)                | The plugin guide, pages, permissions, versions, testing, publishing, and an AI skill           |
| [plugins/reference.md](dev/plugins/reference.md) | The plugin API, every call and type (made from [textus.d.ts](dev/textus.d.ts))                 |

## Design (`design/`)

| Document                                         | What it covers                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [design-language.md](design/design-language.md)  | The design standard: tokens, colour, type, layout, shape, motion, components, themes, plugins |
| [plugins.md](design/plugins.md)                  | The plugin system and the market: what is built, and why                                |
| [ai-agent.md](design/ai-agent.md)                | One AI request from start to end: providers, the agent loop, tools, rules for every model |
| [ai-concepts.md](design/ai-concepts.md)          | The AI concepts: project folder, style profile, library, writing rules, skills, priority |
| [ai-proposals.md](design/ai-proposals.md)        | An AI edit's life from streaming to the document, and the three chat surfaces            |
| [ai-paper.md](design/ai-paper.md)                | The long-form paper agent: research, outline, drafting, review                          |
| [ai-eval.md](design/ai-eval.md)                  | Evaluating the AI features against real providers                                       |

## Other

- [releases/](releases/) - release notes, one file per version, in the
  outline of [releases/TEMPLATE.md](releases/TEMPLATE.md). The release workflow uses
  them as the GitHub release's text. Unreleased notes are fragments in
  [releases/next/](releases/next/README.md), one file per change.
- [images/](images/) - README and App Store screenshots
  (`npm run screenshots:readme` regenerates the README's).
- [archive/](archive/) - records that are no longer updated (some in Chinese).
