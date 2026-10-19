# Contributing to Textus

Hi, and thanks for wanting to help. Textus is made by a few people at
CatVinci Studio, and every fix or idea from outside makes a real difference
to us.

This file is everything we'd tell you over a call: how to build the app,
what to run before you push, and the habits the code has grown. It's long,
but you don't need all of it for a first pull request - "Getting set up" and
"Before you push" are enough to start. If you use an AI coding assistant, it
can read the short version in [AGENTS.md](AGENTS.md).

Textus is a Tauri 2 app: React and TypeScript in `src/`, Rust in
`src-tauri/`, and the code that talks to AI providers in
`src-tauri/crates/aicompat/`. Write to us in English or Chinese, whichever is
easier for you.

## Getting set up

You need:

- [Node.js](https://nodejs.org) 22 or later (`.nvmrc` names the version);
- [Rust](https://rustup.rs) via rustup - `src-tauri/rust-toolchain.toml`
  picks the toolchain and adds `rustfmt` and `clippy` on first use;
- the platform's build tools:
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`);
  - **Windows:** Microsoft C++ Build Tools (the "Desktop development with
    C++" workload) and WebView2, which Windows 10 and 11 already have;
  - **Linux (Debian/Ubuntu):**
    `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`.

Then:

```sh
git clone https://github.com/CatVinci-Studio/Textus.git
cd Textus
npm install
npm run tauri dev       # the full app, with hot reload of the frontend
```

`npm run dev` alone serves the frontend at <http://localhost:1420> in a plain
browser. A dev-only shim (`src/dev/tauri-shim.ts`) stubs the Tauri IPC so the
editor still mounts, which makes UI work fast to iterate on - but anything
touching the backend (attachments, windows, AI requests) needs the real app.

`npm run tauri build` makes the installers for your platform (`.dmg`,
`-setup.exe`, `.AppImage`/`.deb`/`.rpm`).

### The browser playground

`src/playground/` is a web edition of the editor alone (no AI, sidebar or
settings), served at <https://textus.catvinci.com/playground/>. It reuses the
editor core (`editor/editor-extensions.ts`) with image storage and clipboard
history left out, and keeps its one document in the browser's localStorage.

```sh
npm run dev:playground     # http://localhost:1450/playground/
npm run build:playground   # dist-playground/, built for /playground/
```

Its entry is `playground.html` and its Vite config `vite.playground.config.ts`,
so `npm run build` and `dist/` are unaffected. CI builds it in the `check` job;
`e2e/playground.spec.ts` runs as the `playground` project of `npm run test:e2e`.

## Where things are

| Path                         | What                                                |
| ---------------------------- | --------------------------------------------------- |
| `src/`                       | the frontend; [architecture.md] maps its folders    |
| `src-tauri/src/`             | the Rust backend: windows, files, AI agent, updater |
| `src-tauri/crates/aicompat/` | the AI provider client (no Tauri dependency)        |
| `src/playground/`            | the browser playground (the editor alone)           |
| `e2e/*.spec.ts`              | Playwright flows (CI)                               |
| `e2e/shots/`                 | screenshot generators (README, website, review)     |
| `scripts/`                   | checks and release tooling, written in Node         |
| `docs/dev/`                  | developer docs: architecture, testing, storage, …   |
| `docs/design/`               | design rules and how the AI features work           |
| `docs/releases/`             | release notes, one file per version                 |
| `packaging/`                 | Homebrew cask, Arch package                         |

[docs/README.md](docs/README.md) lists every document.

[architecture.md]: docs/dev/architecture.md

## Before you push

Run what CI runs - the same commands on Linux, macOS and Windows:

```sh
npm run check          # types, lint, unit tests, formatting, README/version/updater checks
npm run test:e2e       # the Playwright flows (first time: npm run setup:e2e)
npm run check:native   # rustfmt, clippy, Rust tests in src-tauri/ (builds dist/ if missing)
npm run check:all      # all three, in that order
```

`npm run format` and `cargo fmt --all` (in `src-tauri/`) fix formatting in
place. `check:native` passes `--workspace`, so the `aicompat` crate is
checked too.

CI runs `check` on every pull request, and `e2e`, `native` (on Linux, macOS
and Windows) and an iOS simulator build whenever code changed; a
documentation-only change or a version bump runs `check` alone, and a change
only to the Rust backend (`src-tauri/`) skips `e2e`
([scripts/ci-changes.mjs](scripts/ci-changes.mjs) decides).

## Tests

[docs/dev/testing.md](docs/dev/testing.md) maps what each suite covers and
what is deliberately not covered. In short:

| Kind                  | Where                                   | Runs                                      |
| --------------------- | --------------------------------------- | ----------------------------------------- |
| Unit (frontend)       | `src/**/*.test.ts(x)`, next to the code | `npm test`, in `check`, CI                |
| Unit (Rust)           | `#[cfg(test)] mod tests` in the module  | `check:native`, CI                        |
| E2E flows             | `e2e/*.spec.ts`                         | `npm run test:e2e`, CI                    |
| Visual baselines      | `e2e/visual.spec.ts-snapshots/`         | `npm run test:visual`, Linux, by hand     |
| Screenshot generators | `e2e/shots/`                            | `npm run screenshots:*`, by hand          |
| Built-app smoke test  | `scripts/smoke-linux.sh --build`        | by hand, before a release                 |
| Live AI evaluation    | `src-tauri/src/ai/live_eval*`           | by hand, needs an API key and costs money |

Name a test as the claim it makes, not as the function it calls:

```
a_model_this_login_cannot_use_falls_back_to_the_default
brings the chip back for a NEW selection after one was dismissed
```

A test whose name is `test_parse` tells a future reader nothing about what
broke when it fails.

The e2e flows run the frontend in Chromium against the dev Tauri shim, not
in WebKitGTK or WebView2, so native behaviour - window management, drag
between windows, file dialogs, the updater - is still verified by running the
app. If your change touches those, say in the pull request what you
exercised by hand.

## Branches and pull requests

Fork the repository (or branch from `main` if you have write access), make
your change, and open a pull request against `main`. A branch name that says
what it does helps: `fix/pdf-margins`, `feat/sidebar-width`.

A few things make a pull request easy for us to say yes to:

- It does one thing. Two fixes are two pull requests.
- The description says why. What was broken, or what you wanted to do; the
  commits can carry the details.
- If it changes something you can see, a before and after screenshot.
- If it touches windows, drafts or anything that could lose someone's
  writing, a line on what you tried by hand.

CI has to pass before we can merge, and a maintainer reviews
every pull request. We try to answer within a few days. If we haven't, a
friendly nudge on the pull request is welcome - it usually means it slipped
past us, not that we're ignoring you.

Releases are tags on `main` - see [docs/dev/releasing.md](docs/dev/releasing.md).

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), with an
optional scope naming the area (`chat`, `ai`, `ui`, `editor`, `settings`,
`drafts`, `export`, `ci`):

```
fix(drafts): stop a new window recovering documents that are still open
feat(chat): read PDF, Office and image attachments
refactor(ui): one icon set, no emoji
```

Prefixes in use: `feat`, `fix`, `refactor`, `perf`, `style`, `docs`, `test`,
`build`, `chore`, `ci`.

**Split by concern, not by file.** A branch that fixes three things should be
three commits. The subject says what changed; the body says **why it was
wrong**: the failure it prevents, not a restatement of the diff. Silent
failure modes are worth spelling out, because nobody will rediscover them
from the code:

> Draft recovery answers a LAUNCH-time question, but the drain is per-window,
> and a window can be created at any time. Once the app is up, every snapshot
> on disk belongs to a live dirty tab, so Cmd+T "recovered" a document that
> was still open and unsaved.

## Code style

**Know where code goes.** [docs/dev/architecture.md](docs/dev/architecture.md)
maps the folders and the layers they sit in. A folder never imports from a
layer above it; `npm run lint` fails if one does. Interface rules (spacing,
type sizes, buttons, menus, motion) are in
[docs/design/design-language.md](docs/design/design-language.md).

Formatting is automated (Prettier, rustfmt, `.editorconfig`), so it is not
worth discussing. What is worth discussing:

**Comments explain why, not what.** The codebase leans on this heavily. A
comment earns its place by recording a constraint, a rejected alternative, or
a bug that a future edit would otherwise reintroduce. Match the density of the
file you are editing.

**Cross-language contracts point at each other.** Any shape that exists in
both Rust and TypeScript carries a comment on each side naming the other
(`ChatAttachment`, `AgentTurn`, `StreamEvent`, `ProviderCatalogEntry`, the
chat-window protocol). If you change one, the comment tells you what else to
change.

**Prefer deepening the mechanism over special-casing.** A new `if` in shared
code to serve one caller usually means the fix is at the wrong depth.

**Names.** Files are `kebab-case.ts`, React components `PascalCase.tsx`,
tests `name.test.ts` beside the file they test, e2e specs `name.spec.ts`,
Rust modules `snake_case.rs`, scripts `verb-noun.mjs`.

## Writing

**Interface text** is in ten languages: `src/i18n/locales/` holds en, zh,
zh-Hant, ja, ko, es, fr, de, ru and pt. Every new string goes into all ten,
and `npm run check` fails if one is missing. If you only know some of the
languages, put the English text in the others and say so in the pull
request; we'll translate them. More in
[docs/dev/translating.md](docs/dev/translating.md).

**Documentation and release notes** are in English. Write the way you'd
explain something to a colleague: plain words, short sentences, what happens
and then why. Skip the marketing ("seamless", "powerful") and the filler
("This document describes…"). For the details we keep consistent:

- One `#` heading per file; headings in sentence case ("Getting set up").
- UI paths in bold with › between steps: **Settings › Theme**. Buttons and
  other on-screen words in bold, exactly as the UI shows them: **Copy link**.
- Code, file names, commands and settings keys in backticks:
  `npm run check`, `src/theme/`. Shortcuts as `Ctrl/⌘ + Shift + E`.
- Versions as `1.0.4`, dates as `2026-10-17`.
- Lists: one item per point. Full sentences end with a period; fragments
  don't.
- Links: relative paths for files in this repository, full URLs otherwise.

Release notes start from [docs/releases/TEMPLATE.md](docs/releases/TEMPLATE.md):
sections New, Improved, Fixed, Platform notes, in that order; one change per
bullet, starting with a verb, describing what the user notices; the issue or
pull request at the end, as in `(#68)`.

The README (`README.md` and its nine translations) is for users. Its
translations keep the English file's headings, code blocks and links;
`scripts/check-readmes.mjs` checks that.

## Stuck?

Ask. Open a draft pull request with what you have, or an issue, or find us
on [Discord](https://textus.catvinci.com/discord) (English) or in the QQ and
WeChat groups listed in the README (Chinese). A half-finished pull request
with a question is better than a finished one that went the wrong way.
