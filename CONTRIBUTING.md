# Contributing to Textus

Hi, and thanks for wanting to help. Textus is made by a few people at
CatVinci Studio, and every fix or idea from outside makes a real difference
to us.

This file is everything we'd tell you over a call: how to build the app,
what to run before you push, and the habits the code has grown. You don't
need all of it for a first pull request - "Getting set up" and "Before you
push" are enough to start. If you use an AI coding assistant, it reads
[AGENTS.md](AGENTS.md), which points back here.

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
    `sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf`.

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

The official plugins no longer ship with the app. The dev server serves
them from a checkout of
[textus-plugins](https://github.com/CatVinci-Studio/textus-plugins) in a
folder named `textus-plugins` beside (or above) this repository, or at
`TEXTUS_PLUGINS_DIR` (`vite.dev-plugins.ts`); without one the plugin
catalog is empty and the plugin e2e flows fail or skip. Run `npm ci` in
that checkout once.

`npm run tauri build` makes the installers for your platform (`.dmg`,
`-setup.exe`, `.AppImage`/`.deb`/`.rpm`).

### The browser playground

`src/playground/` is a web edition of the editor alone (no AI, sidebar or
settings), served at <https://textus.md/playground/>. It reuses the
editor core (`editor/editor-extensions.ts`) with image storage left out,
and keeps its one document in the browser's localStorage.

```sh
npm run dev:playground     # http://localhost:1450/playground/
npm run build:playground   # dist-playground/playground/, built for /playground/
```

Its entry is `playground.html` and its Vite config `vite.playground.config.ts`,
so `npm run build` and `dist/` are unaffected. CI builds it in the `check` job;
`e2e/playground.spec.ts` runs as the `playground` project of `npm run test:e2e`.
It is deployed after each newest stable release, not from `main`
(`deploy-playground.yml`, called by `release.yml`;
[infrastructure.md](docs/dev/infrastructure.md#playground)).

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
| `docs/releases/`             | release notes per version; unreleased in `next/`    |
| `packaging/`                 | Arch package, Linux desktop entry                   |

[docs/README.md](docs/README.md) lists every document.

[architecture.md]: docs/dev/architecture.md

## Before you push

Run what CI runs - the same commands on Linux, macOS and Windows:

```sh
npm run check          # everything in the table below
npm run test:e2e       # the Playwright flows (first time: npm run setup:e2e)
npm run check:native   # rustfmt, clippy with warnings as errors, Rust tests (app crate and aicompat)
npm run check:all      # all three, in that order
npm run check:quick    # while you work: typecheck, then lint, format and tests for the files you changed
```

`npm run format` and `cargo fmt --all` (in `src-tauri/`) fix formatting in
place. `check:native` builds `dist/` first if it is missing, since the
crate embeds it.

`npm run check` runs, in order:

| Step                                 | Holds                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `tsc` (`npm run typecheck`)          | Types                                                                                                         |
| ESLint (`npm run lint`)              | The import layers, and Tauri only behind `src/platform/` ([architecture.md](docs/dev/architecture.md#layers)) |
| vitest (`npm test`)                  | Unit and editor tests, the save round trip, the docs' facts held to the code                                  |
| Prettier (`npm run format:check`)    | Formatting                                                                                                    |
| `scripts/check-readmes.mjs`          | The README's translations keep the English one's headings, code blocks and links                              |
| `scripts/check-code-shape.mjs`       | 600 lines a file, 8 hooks a component, no provider id compared outside its adapter                            |
| `scripts/check-cycles.mjs`           | No import cycles                                                                                              |
| `scripts/check-duplicates.mjs`       | No run of code copied instead of shared (jscpd); the copies there today are listed and may only go            |
| `knip`                               | No unused file, export or dependency (`knip.json`)                                                            |
| `scripts/check-versions.mjs`         | The five version files agree                                                                                  |
| `scripts/check-nsis-template.mjs`    | The Windows installer template matches Tauri's                                                                |
| `scripts/updater-manifest.mjs check` | The updater reads `textus-latest.json`, never `latest.json`                                                   |

Two things only a build checks, so CI's `check` job builds after it: the
startup budget (`vite.startup-budget.ts` fails a build whose entry chunk
passes 1.25 MB) and CSS syntax. Run `npx vite build` if you changed what
loads at startup. The Rust tests fail while the generated bindings in
`src/platform/bindings/` are stale: `npm run bindings` writes them.

CI runs `check` on every pull request, and the other jobs where the change
can reach them; [testing.md](docs/dev/testing.md#how-ci-is-laid-out) has
the table.

## Tests

[docs/dev/testing.md](docs/dev/testing.md) says which layer a new test
belongs in, how to run each suite, how to use the e2e helpers, and what is
deliberately not covered. A test goes in the lowest layer that can catch
its mistake: what a key or a paste does to the document is an editor
integration test in vitest, and an e2e flow is for what only a browser
shows - focus, menus, scrolling, layout.

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

**Send every pull request to `main`.** Branch from `main` (or fork), name
the branch after what it does (`fix/pdf-margins`), and if `main` moves on
while you work, merge it into your branch. Pull requests are
squash-merged, so the title and description become the commit on `main`:
write the title as a plain English sentence that says what changed, and
the description as why. The branch, release and commit rules are in
[docs/dev/releasing.md](docs/dev/releasing.md#pull-requests-and-commits).

If your pull request fixes a bug in the released version, say which
version in the description (the template asks); the fix ships in the next
release.

A few things make a pull request easy for us to say yes to:

- The description says why. What was broken, or what you wanted to do; the
  commits can carry the details.
- If it changes something you can see, a before and after screenshot.
- If it touches the window (title bar, traffic lights, dragging, full
  screen), the sidebar or AI panel's layout or animation, or keyboard
  shortcuts, a short screen recording of the built app doing it on a Mac -
  windowed and full screen - and on Windows or Linux if it changes there.
  The automated tests run in a browser and can't see any of this.
- If it touches drafts or anything that could lose someone's writing, a
  line on what you tried by hand.
- A release note as a file of its own in `docs/releases/next/` (see
  [Writing](#writing)).
- It leaves CI and the test setup alone. If a check looks wrong, open a
  separate pull request about the check. From a fork, a pull request that
  changes `.github/` or the test configuration fails the `ci-config` check
  on purpose, and asks the maintainers for a review: we take it from there.

CI has to pass before we can merge, and a maintainer reviews every pull
request ([who can do what](docs/dev/roles.md)). We try to answer within a
few days. If we haven't, a friendly nudge on the pull request is welcome -
it usually means it slipped past us, not that we're ignoring you.

## Code style

**Know where code goes.** [docs/dev/architecture.md](docs/dev/architecture.md)
maps the folders and the layers they sit in. A folder never imports from a
layer above it; `npm run lint` fails if one does.
[docs/dev/recipes.md](docs/dev/recipes.md) walks through the common
additions (a setting, a menu item, a backend command, a string, a plugin
API call, an e2e test), and [docs/dev/reuse.md](docs/dev/reuse.md) lists
the one place for each common need. Interface rules (spacing, type sizes,
buttons, menus, motion) are in
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

### Code shape

**Pure logic inside, side effects outside.** Deciding what happens - what
the tags in a reply become, where a margin card stands, what a stored
setting means - is a pure function of its inputs, in a module of its own,
with unit tests. Reading the DOM, calling the backend, timers and listeners
stay at the edge: a hook or a command that calls the pure part.

**Components connect; hooks hold the concerns.** A component reads its
feature's state and draws it. More than 8 hooks in one component is a
component doing several things: each concern becomes a hook of its own,
named for it (`useFloatingList`, `useComposerInput`, `useRowDrag`), in the
component's file or beside it.

**600 lines a file at most.** Split by concern, not by line count: each part
is something you can name in its first comment. Tests, the dev shim
(`src/dev/`), the live AI evaluation (`live_eval/`), the translation tables
and the icon table are not held to it. Rust tests sit inline in a
`#[cfg(test)] mod tests` or, once they would push a module past the limit,
in a `tests.rs` beside it (`foo.rs` and `foo/tests.rs`): inline tests count
towards the module's lines.

**Provider differences are data.** What one AI provider does differently -
a parameter, a name, a model list, a sign-in - is written in the catalog
(`src-tauri/src/ai/catalog.rs`), `aicompat`'s `capabilities.rs` or a table beside the
code that reads it. Outside a provider's own adapter in `aicompat`, no code
compares a provider's id.

**Dead code goes**: a path nothing calls, a flag nothing sets, a fallback
for something nothing writes any more.

`npm run check` holds the hook count, the file size and the provider ids
(`scripts/check-code-shape.mjs`). No file is excused: the lists of
exceptions in that script are empty, and stay so.

**Names.** Files are `kebab-case.ts`, React components `PascalCase.tsx`,
tests `name.test.ts` beside the file they test, e2e specs `name.spec.ts`,
Rust modules `snake_case.rs`, scripts `verb-noun.mjs`.

## Writing

**Interface text** is in ten languages: `src/i18n/locales/` holds en, zh,
zh-Hant, ja, ko, es, fr, de, ru and pt. Every new string goes into all ten,
and `npm run check` fails if one is missing. Put a new key beside the keys
of the same feature, not at the end of the file, where every other pull
request adds its own and they conflict. If you only know some of the
languages, put the English text in the others and say so in the pull
request; we'll translate them. The steps are in
[docs/dev/recipes.md](docs/dev/recipes.md#add-a-ui-string); a whole
language is [docs/dev/translating.md](docs/dev/translating.md).

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

A pull request doesn't edit `docs/releases/X.Y.Z.md`: it adds its note as a
file of its own in [docs/releases/next/](docs/releases/next/README.md),
named after the change (`pdf-page-numbers.md`), holding the section heading
and the bullet:

```md
### Fixed

- Keeps the caret where it was when you switch tabs. (#123)
```

Pull requests then never change the same lines, so one merged before yours
doesn't send yours back for a rebase. The release collects the fragments
into `docs/releases/X.Y.Z.md` ([releasing.md](docs/dev/releasing.md)).

The README (`README.md` and its nine translations) is for users. Its
translations keep the English file's headings, code blocks and links;
`scripts/check-readmes.mjs` checks that.

## Stuck?

Ask. Open a draft pull request with what you have, or an issue, or find us
on [Discord](https://textus.md/discord) (English) or in the QQ and
WeChat groups listed in the README (Chinese). A half-finished pull request
with a question is better than a finished one that went the wrong way.
