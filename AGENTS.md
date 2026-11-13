# Agent guide

We use AI coding assistants on Textus ourselves, and so do some of our
contributors. This file is what we hand them: where things are, and the
few rules that have gone wrong before and must not again. The full rules
are in [CONTRIBUTING.md](CONTRIBUTING.md) and the documents it links; if
this file and they ever disagree, they win - and please tell us.

## Where things are

Textus is a Markdown editor for macOS, Windows, Linux, iPhone and iPad,
built with Tauri 2: a React + TypeScript frontend in `src/` (the editor is
Milkdown/ProseMirror, source mode CodeMirror 6) and a Rust backend in
`src-tauri/`.

| Need                                                   | Read                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| Setup, the checks to run, code style, writing          | [CONTRIBUTING.md](CONTRIBUTING.md)                               |
| Folders, layers and what ESLint enforces; the backend  | [docs/dev/architecture.md](docs/dev/architecture.md)             |
| How to add a setting, menu item, command, string, test | [docs/dev/recipes.md](docs/dev/recipes.md)                       |
| The one place for each common need: reuse it           | [docs/dev/reuse.md](docs/dev/reuse.md)                           |
| Tabs, opening, saving, drafts, closing                 | [docs/dev/documents.md](docs/dev/documents.md)                   |
| Which test layer, the e2e helpers, CI                  | [docs/dev/testing.md](docs/dev/testing.md)                       |
| Branches, pull requests, commits, releases             | [docs/dev/releasing.md](docs/dev/releasing.md)                   |
| Desktop and iOS: what is shared, what is gated         | [docs/dev/ios-code-map.md](docs/dev/ios-code-map.md)             |
| The interface's design standard                        | [docs/design/design-language.md](docs/design/design-language.md) |
| Every other document                                   | [docs/README.md](docs/README.md)                                 |

## Rules

- **Branches and pull requests** follow
  [releasing.md](docs/dev/releasing.md#pull-requests-and-commits): work goes
  to `main` from a branch, never pushed directly; plain English commit
  messages; don't merge a pull request yourself unless asked.
- **Run the checks** before you say a change is done: `npm run check`
  while you work (`npm run check:quick` for only your files), and
  `npm run check:all` before a pull request ([CONTRIBUTING.md](CONTRIBUTING.md#before-you-push)).
- **Don't change CI or the test setup to make a check pass**: `.github/`,
  `playwright*.config.ts`, `vite*.config.ts`, `eslint.config.js`,
  `tsconfig*.json`, `scripts/check-*.mjs`, `e2e/helpers.ts`, or a test's
  expectation. Fix the code; if a check is truly wrong, change it in a pull
  request of its own that says why.
- **Reproduce a bug before fixing it**, in the engine where it was seen,
  and add a test in the lowest layer that catches it; check that it fails
  without the fix ([testing.md](docs/dev/testing.md)).
- **Check native behaviour in the built app** (`npm run tauri build -- --debug`):
  the window bar, title bar and traffic lights, drag regions, full screen,
  the side panels' layout and motion, `Cmd` shortcuts that have a menu
  item, file dialogs, input methods. A browser can't show these. Say in
  the pull request what you ran.
- **Generated files are never edited by hand**: `src/platform/bindings/`
  (`npm run bindings`), `docs/dev/plugins/reference.md`
  (`node scripts/plugin-reference.mjs`). The checks fail while they are
  stale.
- **Drag with pointer events** (`src/engine/drag/pointer-drag.ts`), never HTML drag
  and drop: the window's file drop swallows it.
- **The e2e plugin flows need a textus-plugins checkout** beside the
  repository or at `TEXTUS_PLUGINS_DIR`; without one the catalog is empty
  ([testing.md](docs/dev/testing.md#the-official-plugins)).
- **Keep the code shape**: at most 600 lines a file and 8 hooks a
  component, pure logic apart from side effects, provider differences as
  data. Make the smallest change that fixes the cause, match the
  surrounding code, and write comments that say why, not what.
- **Startup**: anything first used after a click or a keystroke loads
  through `lazyModule` (`src/lazy/lazy-module.ts`); the startup layer
  imports none of it. A pull request that grows the entry chunk says by how
  much, and why it can't wait.
- **Every user-visible string goes into all ten locale files** in
  `src/i18n/locales/` ([recipes.md](docs/dev/recipes.md#add-a-ui-string)).
- **Shapes shared by Rust and TypeScript** carry a comment on both sides
  naming the other; change both.
- **Interface work** follows [design-language.md](docs/design/design-language.md):
  tokens only (no raw colour, radius or font size in a component), and its
  review checklist (section 17) before a pull request that changes how
  something looks.
- **iOS is the same app in a narrower layout**: gate only what the platform
  can't do, with `#[cfg(desktop)]` and the flags in
  `src/platform/capabilities.ts`, never to hide a feature
  ([ios-code-map.md](docs/dev/ios-code-map.md)).
- **WebView2 can be as old as Chromium 105**: newer CSS goes behind
  `@supports` ([webview-support.md](docs/dev/webview-support.md)).
- **A release note** is a new file under `docs/releases/next/`
  ([its README](docs/releases/next/README.md)), never an edit to
  `docs/releases/X.Y.Z.md`. Documentation and notes are English.

## Safety

- Never commit or print secrets: anything named `*.local`, API keys, tokens,
  `AuthKey_*.p8`, signing keys.
- Never run an installed Textus (`/usr/bin/textus`, `/Applications/Textus.app`)
  for testing, and never point a test build at a real user's data. Run
  `npm run tauri dev` with throwaway data folders (on Linux set
  `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME`
  to a temporary directory; [storage.md](docs/dev/storage.md) lists the
  folders on each platform).
- Never `rm -rf` a path built from a variable; move files to the trash or a
  scratch folder instead. Don't kill processes you didn't start.
- Don't drive the user's desktop (synthetic key presses, focusing windows)
  without being asked.
- The updater: Textus publishes `textus-latest.json`, never `latest.json`
  (that name belongs to old Levis installs). `npm run check` guards this;
  don't work around it.
- Don't change signing, notarization, release or store workflows unless the
  task is about them.

## Fork releases (luckylew23/Textus)

This fork releases from `.github/workflows/release-fork.yml`, modeled on
the Tydora fork's pipeline: pushing a `v*.*.*` tag builds and publishes
directly, or
`gh workflow run -R luckylew23/Textus release-fork.yml
-f tag=<tag> --ref proxy-authentication`. One build job per platform
feeds one publish job, so no two builds race for the release. What the
first fork release (v1.4.1-rc.3, 2026-11-13) established; drop this
section when syncing from upstream:

- **Version**: follow upstream's version and raise only the rc suffix
  (`1.4.1-rc.N`). Every file `scripts/check-versions.mjs` lists moves
  together (package.json, package-lock.json, src-tauri/tauri.conf.json,
  src-tauri/Cargo.toml, Cargo.lock); the publish job re-checks the tag.
  The tag must exist on the remote before dispatching.
- **Updater signing**: the fork has its own `TAURI_SIGNING_PRIVATE_KEY`
  (created 2026-11-13, empty password) in the Actions secrets; fork
  releases never publish latest.json, so the key is not the upstream one.
- **macOS unsigned**: no Apple Developer account, so release-fork.yml
  sets none of the APPLE secrets and tauri build ships unsigned DMGs
  (Gatekeeper: right-click - Open on first launch).
- **Platforms**: only macOS Apple-silicon DMG and Windows x64 (NSIS +
  portable zip). The windows job adds a portable zip
  (`Textus_<version>_x64_portable.zip`, built with 7z so `Textus/` is
  the zip's root folder).
- **Upstream's release.yml is disabled on this fork** (Actions settings)
  and carries no fork edits - re-enable it and delete release-fork.yml
  when returning to the upstream flow. Only this AGENTS.md section and
  release-fork.yml are fork files, so upstream sync never conflicts.
- **Pushing workflow files needs SSH**: the gh OAuth token has no
  `workflow` scope, so an https push that adds or changes anything under
  `.github/workflows/` is rejected ("refusing to allow an OAuth App...")
  - long after the real error surfaced as connect timeouts. The origin
  points at `git@github.com:...` (SSH, port 22 works here) and pushes
  workflow commits fine.
- **A workflow_dispatch needs the workflow on the default branch**;
  release-fork.yml is only on `proxy-authentication`. Releasing from the
  branch therefore means: move the tag onto a commit that carries
  release-fork.yml and push it (`git tag -f v... <commit> && git push -f
  origin v...`) - the tag push event runs the workflow from the commit
  the tag points at.
- **Network**: pushes and Actions checks fail when GitHub is unreachable
  from the intranet. A failed or cancelled run is no loss: dispatch the
  same tag again after the network is back.
