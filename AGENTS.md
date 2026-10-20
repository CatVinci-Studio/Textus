# Agent guide

We use AI coding assistants on Textus ourselves, and so do some of our
contributors. This file is what we hand them: the short version of
[CONTRIBUTING.md](CONTRIBUTING.md), plus the few things that have gone wrong
before and must not again. If the two ever disagree, CONTRIBUTING.md wins -
and please tell us.

## The project

Textus is a Markdown editor for macOS, Windows, Linux, iPhone and iPad,
built with Tauri 2.

- `src/` - React + TypeScript frontend; the editor is Milkdown/ProseMirror.
  [docs/dev/architecture.md](docs/dev/architecture.md) maps the folders and
  their layers; ESLint enforces the import direction.
- `src-tauri/src/` - Rust backend: windows, files, menus, updater, the AI
  agent. `src-tauri/crates/aicompat/` - the AI provider client.
- `e2e/` - Playwright flows; `e2e/shots/` - screenshot generators (not tests).
- `docs/dev/` developer docs, `docs/design/` design and AI behaviour,
  `docs/releases/` release notes. Index: [docs/README.md](docs/README.md).

## Commands

Same on Linux, macOS and Windows:

```sh
npm install
npm run tauri dev      # run the app
npm run check          # types, lint, unit tests, formatting, README/version checks
npm run test:e2e       # Playwright flows (first time: npm run setup:e2e)
npm run check:native   # rustfmt, clippy, Rust tests
npm run check:all      # all three - run before you open a pull request
```

If another copy of the e2e suite may be running (another worktree), set
`PLAYWRIGHT_PORT` to a free port.

## How to work

- Branch from `origin/main` (`feat/…`, `fix/…`, `docs/…`, `chore/…`), open a
  pull request to `main`, and don't merge it yourself unless asked.
- Don't stack pull requests by default: each one starts from `main`, so any
  of them can merge in any order. When a change depends on another that
  hasn't merged, wait for it, or put the dependent steps in one pull request
  as separate commits. Stack only when one PR would be too large to review;
  a stack is then merged bottom-up with a merge commit, not squashed, so the
  next PR in it still applies cleanly.
- Make the smallest change that fixes the cause. Match the surrounding code:
  naming, structure, comment density. Comments say why, not what.
- Add or update tests with the change: unit tests next to the code
  (`name.test.ts`, `#[cfg(test)]`), an e2e spec for user-visible flows. Name
  tests as the claim they make.
- Every user-visible string goes into all ten locale files in
  `src/i18n/locales/` (en, zh, zh-Hant, ja, ko, es, fr, de, ru, pt).
- Shapes shared by Rust and TypeScript carry a comment on both sides naming
  the other; change both.
- Interface work follows [docs/design/design-language.md](docs/design/design-language.md)
  (radii, type sizes, buttons, menus, motion tokens in `src/ui/motion.css`).
- Commits: Conventional Commits in English (`fix(export): …`); the body says
  why the old behaviour was wrong. No "generated with" trailers, and no
  `Co-authored-by` except to credit an outside contributor whose work the
  commit ports.
- Documentation and release notes are English and follow the format in
  CONTRIBUTING.md › Writing. A release note goes in a new file of its own
  under `docs/releases/next/` (see its README), never into
  `docs/releases/X.Y.Z.md`.

## Safety

- Never commit or print secrets: anything named `*.local`, API keys, tokens,
  `AuthKey_*.p8`, signing keys.
- Never run an installed Textus (`/usr/bin/textus`, `/Applications/Textus.app`)
  for testing, and never point a test build at a real user's data. Run
  `npm run tauri dev` with throwaway data folders (on Linux set
  `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME`
  to a temporary directory).
- Never `rm -rf` a path built from a variable; move files to the trash or a
  scratch folder instead. Don't kill processes you didn't start.
- Don't drive the user's desktop (synthetic key presses, focusing windows)
  without being asked.
- The updater: Textus publishes `textus-latest.json`, never `latest.json`
  (that name belongs to old Levis installs). `npm run check` guards this; don't
  work around it. See [docs/dev/releasing.md](docs/dev/releasing.md).
- Don't change signing, notarization, release or store workflows unless the
  task is about them.

## Platform notes

- Linux uses WebKitGTK, Windows WebView2, macOS and iOS WKWebView; the e2e
  flows run in Chromium. Anything about windows, file dialogs, drag and drop,
  input methods or printing has to be checked in the real app on that
  platform.
- Chinese/Japanese input (IME) on WebKitGTK commits a composition as
  `deleteCompositionText` then `insertFromComposition`; keep that in mind
  when touching input handling (`src/editor/keys/`).
- iOS shares the frontend; desktop-only code is gated (`#[cfg(desktop)]`,
  `isDesktopApp`). [docs/dev/ios-code-map.md](docs/dev/ios-code-map.md) has
  the split.
