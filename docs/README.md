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
| [storage.md](dev/storage.md)                        | Every file the app writes (settings, UI state, history), per platform, and the Levis import       |
| [lifecycle.md](dev/lifecycle.md)                    | Launching, closing and quitting, background mode and its tray, updates, and what a windowless process costs |
| [saving.md](dev/saving.md)                          | What a save writes to a Markdown file: unedited blocks as written, edited ones serialized         |
| [translating.md](dev/translating.md)                | The ten UI languages: which files a translation fills, tone, and how it is checked                |
| [releasing.md](dev/releasing.md)                    | Branches, tags, the desktop release, pre-releases, the updater manifest                           |
| [infrastructure.md](dev/infrastructure.md) | The other repositories, the automation, the website and downloads, the secrets and how to replace them |
| [ios-release.md](dev/ios-release.md)                | Shipping the iOS app: App Store Connect setup, keys, TestFlight, review                           |
| [ios-code-map.md](dev/ios-code-map.md)              | What the desktop and iOS apps share and what is desktop-only; building on a Mac                   |
| [windows-installer.md](dev/windows-installer.md)    | The NSIS installer, and why there is no MSI                                                       |

## Design (`design/`)

| Document                                         | What it covers                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [design-language.md](design/design-language.md)  | Interface rules: radii, type sizes, buttons, menus, dialogs, motion, themes             |
| [ai-concepts.md](design/ai-concepts.md)          | The AI concepts: project folder, style profile, library, writing rules, skills, priority |
| [ai-proposals.md](design/ai-proposals.md)        | An AI edit's life from streaming to the document, and the three chat surfaces            |
| [ai-eval.md](design/ai-eval.md)                  | Evaluating the AI features against real providers                                       |
| [ai-tokens.md](design/ai-tokens.md)              | What each AI request sends, what is cached, and the plan for using fewer tokens         |

## Other

- [releases/](releases/) - release notes, one file per version, in the
  outline of [releases/TEMPLATE.md](releases/TEMPLATE.md). The release workflow uses
  them as the GitHub release's text. Unreleased notes are fragments in
  [releases/next/](releases/next/README.md), one per pull request.
- [images/](images/) - README and App Store screenshots
  (`npm run screenshots:readme` regenerates the README's).
- [archive/](archive/) - records that are no longer updated (some in Chinese).
