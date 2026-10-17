# Contributing to Textus

Thanks for taking the time. This is a Tauri app: a React + TypeScript
frontend in `src/`, a Rust backend in `src-tauri/`, and a provider-agnostic
AI client crate in `src-tauri/crates/aicompat/`.

## Getting set up

```sh
npm install
npm run tauri dev
```

You need a stable Rust toolchain and Node 22+. Linux also needs
`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`.

`npm run dev` alone serves the frontend at <http://localhost:1420> in a plain
browser. A dev-only shim (`dev/tauri-shim.ts`) stubs the Tauri IPC so the
editor still mounts, which makes UI work fast to iterate on - but anything
touching the backend (attachments, windows, AI requests) needs the real app.

## Before you push

Run exactly what CI runs - the same commands on Linux, macOS and Windows:

```sh
npm run check          # types, lint, unit tests, formatting, README/version/updater checks
npm run test:e2e       # the Playwright flows (first time: npm run setup:e2e)
npm run check:native   # rustfmt, clippy, Rust tests in src-tauri/ (builds dist/ if missing)
npm run check:all      # all three, in that order
```

`npm run format` and `cargo fmt --all` (in `src-tauri/`) fix formatting in
place. `check:native` passes `--workspace`, so the `aicompat` crate is
checked too; `src-tauri/rust-toolchain.toml` and `.nvmrc` name the Rust and
Node versions.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), with an
optional scope naming the area (`chat`, `ai`, `ui`, `editor`, `settings`,
`drafts`, `ci`):

```
fix(drafts): stop a new window recovering documents that are still open
feat(chat): read PDF, Office and image attachments
refactor(ui): one icon set, no emoji
```

Prefixes in use: `feat`, `fix`, `refactor`, `perf`, `style`, `docs`, `test`,
`chore`, `ci`.

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

**Know where code goes.** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) maps
the folders and the layers they sit in. A folder never imports from a layer
above it; `npm run lint` fails if one does.

Formatting is automated, so it is not worth discussing. What is worth
discussing:

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

## Tests

Five suites, cheapest first - see `docs/TESTING.md` for the full map and for
what is deliberately _not_ covered:

```sh
npm run check                          # typecheck, lint, vitest, prettier, README structure
npm run check:native                   # rustfmt, clippy, Rust tests (app crate + aicompat)
npm run test:e2e                       # Playwright flows in Chromium, desktop and phone
scripts/smoke-linux.sh --build         # the built Linux app and its .deb
cd src-tauri && cargo test --lib live_eval -- --ignored --nocapture --test-threads=1
                                       # real Anthropic API (costs cents)
```

The first three run in CI. The rest need a display, a desktop session or an
API key, and are run by hand before a release.

The e2e flows need Chromium once: `npm run setup:e2e`. They don't compare
screenshots, so they pass the same on every platform. `npm run test:visual`
also compares `e2e/visual.spec.ts`'s screenshots against Linux baselines
(fonts differ elsewhere); after an intended UI change, on Linux,
`npm run test:visual -- --update-snapshots` and look at every changed image
before keeping it.

New tests belong next to the code (`foo.ts` → `foo.test.ts`, `#[cfg(test)]
mod tests` in Rust). Name them as the claim they make, not as the function
they call:

```
a_model_this_login_cannot_use_falls_back_to_the_default
brings the chip back for a NEW selection after one was dismissed
```

A test whose name is `test_parse` tells a future reader nothing about what
broke when it fails.

The visual suite runs the frontend in Chromium against the dev Tauri shim, not
in WebKitGTK or WebView2, so native behaviour - window management, drag
between windows, file dialogs, the updater - is still verified by running the
app. If your change touches those, say in the PR what you exercised by hand.

## Pull requests

Target `main`. CI must pass. Keep the PR description focused on _why_; the
commit bodies carry the detail.

If a change is visible, include a before/after screenshot. If it touches
window behaviour, drafts, or anything that can lose the user's work, say
explicitly what you tested by hand.

## Releases

Maintainers only. The desktop release is below; the iOS app ships
separately, from an `ios-v*` tag through `.github/workflows/ios-release.yml`
to TestFlight - see `docs/ios/release.zh.md`. `docs/README.md` indexes the
rest of the documentation.

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json`, then run `npm install --package-lock-only`
   and `cargo check` (in `src-tauri/`) so `package-lock.json` (both of its
   version fields) and `Cargo.lock` follow. `node scripts/check-versions.mjs`
   (part of `npm run check`) fails until all five files agree.
2. Write the release notes in `docs/releases/X.Y.Z.md` - the release
   workflow refuses a stable tag without them.
3. Commit as `chore: bump version to X.Y.Z`.
4. Tag `vX.Y.Z` and push the tag. `.github/workflows/release.yml` checks
   that the tag matches the version in those files, then builds,
   signs and notarizes for macOS/Windows/Linux, publishes the GitHub release,
   points the Homebrew cask at it, and sends the tested `textus-bin` package
   to the `[catvinci]` pacman repository in `CatVinci-Studio/arch-repo` (see
   `packaging/arch/README.md`).

**Pre-releases**: a tag carrying a semver pre-release suffix (`v0.9.0-rc.1`)
is published as a GitHub pre-release. The version files carry the same
suffix (`0.9.0-rc.1`): the tag check compares the whole version, and
release notes are only required for stable tags. It skips the Homebrew
cask and the `[catvinci]` pacman repository, so it reaches nobody who did not
go looking for it - the in-app updater reads
`releases/latest/download/textus-latest.json`, and `releases/latest`
excludes pre-releases.

**Updater manifest**: Textus's manifest is `textus-latest.json`, never
`latest.json`. Levis 0.9.x installs read `latest.json` from this repository
(the old `CatVinci-Studio/Levis` URL redirects here) and trust the same
signing key, so a `latest.json` on a Textus release would install Textus over
Levis. tauri-action runs with `includeUpdaterJson: false`; the publish job
writes `textus-latest.json` from the draft's `.sig` files
(`scripts/updater-manifest.mjs build`) and refuses to publish a draft that
has a `latest.json` (`... guard`). `npm run check` runs `... check`, which
fails if the updater endpoint or the workflow drifts back.

**Rebuilds**: running the Release workflow by hand on an existing tag
rebuilds and republishes that release. The Homebrew cask and the pacman
repository only move when the tag is the newest stable one, so rebuilding
an old tag never downgrades anyone.

Windows ships only the **NSIS** installer (`-setup.exe`), for stable and
pre-release tags alike - the target list lives in
`src-tauri/tauri.windows.conf.json`. MSI is not built: an MSI install and an
NSIS install don't recognise each other, which made upgrades ask to uninstall
first, and MSI cannot bundle a non-numeric pre-release such as `0.9.0-rc.1`
anyway.
