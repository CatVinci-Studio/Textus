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
npm run check:quick    # the same for only the files you changed - while you work
npm run test:e2e       # Playwright flows (first time: npm run setup:e2e)
npm run check:native   # rustfmt, clippy, Rust tests
npm run check:all      # all three - run before you open a pull request
```

If another copy of the e2e suite may be running (another worktree), set
`PLAYWRIGHT_PORT` to a free port. Building in many worktrees:
[docs/dev/local-builds.md](docs/dev/local-builds.md).

## How to work

- Branch from `origin/main` (`feat/…`, `fix/…`, `docs/…`, `chore/…`), open a
  pull request to `main`, and don't merge it yourself unless asked. One
  feature or fix per branch and pull request; the steps of that one change
  are commits in it.
- Two long-lived branches (docs/dev/releasing.md#branches): `main` is the
  next minor version, with its betas; `stable` is the released version,
  fixes only. When asked to fix a bug the released version has, branch from
  `origin/stable` and open the pull request there; `stable` is merged back
  into `main` after each patch release. Never put a new feature on
  `stable`, and never push to `main` or `stable` directly.
- Branch names: `feat/…`, `fix/…`, `docs/…`, `chore/…` for one change;
  `release/vX.Y.Z` for putting one release together. A feature too large
  for one pull request gets an integration branch `feat/<name>`: its steps
  are pull requests into it, `main` is merged into it at least weekly, and
  it goes to `main` as one pull request when done. Don't open one unless
  asked.
- Don't stack pull requests by default: each one starts from `main`, so any
  of them can merge in any order. When a change depends on another that
  hasn't merged, wait for it, or put the dependent steps in one pull request
  as separate commits. Stack only when one PR would be too large to review;
  a stack is then merged bottom-up with a merge commit, not squashed, so the
  next PR in it still applies cleanly.
- Reproduce a bug before fixing it, and show the fix in the engine where it
  was seen: the e2e flows run Chromium, and WebKit only for the specs in
  `playwright.config.ts`'s `WEBKIT_SPECS` (`E2E_WEBKIT=1`). macOS and iOS
  draw the app with WebKit; add a spec there for editor, sidebar or layout
  work.
- The window bar, title bar and traffic lights, drag regions, full screen,
  the side panels' layout and motion, and `Cmd` shortcuts that also have a
  menu item can't be judged in a browser: check them in the built app
  (`npm run tauri build -- --debug`) on a real Mac, and on Windows or Linux
  when they change there. Say in the pull request what you ran, and attach
  a short screen recording; a change there without one isn't merged.
- Don't change CI (`.github/`), the test setup (`playwright.config.ts`,
  `vite.config.ts`'s `test`, `e2e/helpers.ts`, `scripts/check-*.mjs`) or a
  test's expectation to make a check pass. Fix the code; if a check is truly
  wrong, change it in a pull request of its own that says why.
- Make the smallest change that fixes the cause. Match the surrounding code:
  naming, structure, comment density. Comments say why, not what.
- Keep to the code shape in CONTRIBUTING.md › Code style: pure logic in
  modules of its own, side effects in the hook or command that calls it; at
  most 8 hooks a component and 600 lines a file; provider differences as
  data, never an `if` on a provider's id. `npm run check` holds the limits.
- Add or update tests with the change, each in the lowest layer that can
  catch its mistake ([docs/dev/testing.md](docs/dev/testing.md)): unit tests
  next to the code (`name.test.ts`, `#[cfg(test)]`); what keys, typing and
  pastes do to the document as an editor integration test
  (`src/document-view/editor-view-kit.ts`), not an e2e flow; an e2e spec
  only for what needs a browser. Name tests as the claim they make.
- Every user-visible string goes into all ten locale files in
  `src/i18n/locales/` (en, zh, zh-Hant, ja, ko, es, fr, de, ru, pt).
- Shapes shared by Rust and TypeScript carry a comment on both sides naming
  the other; change both.
- Interface work follows [docs/design/design-language.md](docs/design/design-language.md):
  colours as `--ui-*` / `--doc-*`, shapes as `--shape-*` (containers rounded,
  controls capsules, r = R − p when nested), text by role (`--text-body`, …),
  the two control heights, a 4 px grid, motion tokens from `src/ui/motion.css`.
  No raw colour, radius or font size in a component.
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
  flows run in a current Chromium, but WebView2 can be as old as Chromium
  105: keep newer CSS behind `@supports`
  ([docs/dev/webview-support.md](docs/dev/webview-support.md)). Anything about windows, file dialogs, drag and drop,
  input methods or printing has to be checked in the real app on that
  platform.
- Chinese/Japanese input (IME) on WebKitGTK commits a composition as
  `deleteCompositionText` then `insertFromComposition`; keep that in mind
  when touching input handling (`src/editor/keys/`).
- iOS is the same app in a narrower layout: the same features (plugins,
  themes, skills, tracked changes) through the same code, laid out for a
  phone by the phone styles and `usePhoneLayout`, in Textus's own design
  language (cards, capsules, rounded menus, the theme's fonts and colours),
  not UIKit's look. Gate only what the
  platform can't do (more windows, MCP programs, background mode, a menu
  bar) with `#[cfg(desktop)]` and the flags in `platform/capabilities.ts`,
  never to hide a feature. State a command registered on iOS reads is
  managed in the shared part of `run()`: managed only on the desktop, the
  app aborts on iOS as soon as the page calls it, which
  `scripts/smoke-ios-sim.sh` (CI's `ios` job) catches. The China App Store
  build differs only in leaving Textus AI out (`hasTextusAi`).
  [docs/dev/ios-code-map.md](docs/dev/ios-code-map.md) has the split.
