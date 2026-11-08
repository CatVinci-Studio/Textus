# Releasing

How work reaches `main`, how a test build and a release are cut, and what
the release workflows do. This page is the one place for the branch,
pull request and commit rules; other documents link here.

The desktop app ships from a `vX.Y.Z` tag through
`.github/workflows/release.yml`; the iOS app ships from an `ios-vX.Y.Z` tag
through `.github/workflows/ios-release.yml` (see [ios-release.md](ios-release.md)).
The browser playground isn't released: it is deployed after each newest
stable release ([infrastructure.md](infrastructure.md#playground)).

## Branches

| Branch   | What it is                                                   | Tagged there               |
| -------- | ------------------------------------------------------------ | -------------------------- |
| `main`   | Where all work lands: features and fixes                     | test builds, `vX.Y.Z-rc.N` |
| `stable` | The released version. It moves only by a release from `main` | releases, `vX.Y.Z`         |

- **Test builds are tags on `main`**: `vX.Y.Z-rc.N`, published as GitHub
  pre-releases and offered on the Beta update channel
  ([Pre-releases](#pre-releases)).
- **A release goes from `main` into `stable` in one pull request**
  ("Textus X.Y.Z"), and is published from `stable`: the `vX.Y.Z` tag is
  pushed on the merged `stable` commit ([Desktop release](#desktop-release)).
- A fix the released version needs lands on `main` like any other change,
  and ships in the next release. Nothing is committed to `stable` except a
  release.
- Never push to `main` or `stable` directly. Branch protection requires
  the `check`, `e2e` and `native` CI jobs (and `ci-config`, which only a
  fork's pull request runs). It doesn't require the branch to be up to
  date: a pull request that passed is merged as it is, and the CI run after
  the merge catches the rare case where two changes only break together.
- Older versions are kept as tags (`v1.2.8`, `v1.1.2`; `v0.9.8` for Levis),
  not branches.

## Pull requests and commits

- **One pull request per repository per release.** Maintainers batch the
  work for a release into one branch and one pull request to `main`; its
  steps are commits in it. Don't open a pull request per change, and don't
  stack pull requests. A contributor's pull request goes to `main` as it
  is: we take it from there.
- **Pull requests are squash-merged.** The pull request's title and
  description become the one commit on `main`, so write them as a commit
  message. Merged branches are deleted automatically.
- **Commit messages are plain English sentences** that say what changed,
  not Conventional Commits:

  ```
  Preview tabs: a single click in the file tree opens a file to look at
  Source mode edits as plain text with colours; Enter still continues a list
  ```

  The body, when there is one, says why the old behaviour was wrong: the
  failure it prevents, not a restatement of the diff. No "generated with"
  trailers, and no `Co-authored-by` except to credit an outside contributor
  whose work the commit carries.

- Name a branch after what it does: `fix/pdf-margins`, `feat/sidebar-width`,
  `docs/dev-1310`. Branch from `origin/main`; if `main` moves on while you
  work, merge it into your branch.
- Each pull request adds its release note as a fragment in
  `docs/releases/next/` ([its README](../releases/next/README.md)), never
  into `docs/releases/X.Y.Z.md`.

Both kinds of tag can be published in the same week. A stable tag becomes
GitHub's "Latest" release - the one the updater, the website's downloads,
Homebrew, the mirror and the Arch repository follow - only when it is the
highest stable version (release.yml's "Is this the newest stable tag?"),
and a pre-release never does. The beta channel's manifest only moves
forward (`scripts/updater-manifest.mjs beta`).

## Desktop release

A test build and a release run the same workflow; they differ in the
version, the branch the tag is on, and the notes.

### A test build (`vX.Y.Z-rc.N`)

1. In the release's pull request to `main`, set the version to
   `X.Y.Z-rc.N` in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json`, then run `npm install --package-lock-only`
   and `cargo check` (in `src-tauri/`) so `package-lock.json` (both of its
   version fields) and `Cargo.lock` follow. `node scripts/check-versions.mjs`
   (part of `npm run check`) fails until all five files agree.
2. Once it is merged, tag that exact commit on `main`:

   ```sh
   git fetch origin
   node scripts/check-versions.mjs --tag vX.Y.Z-rc.N   # on a checkout of origin/main
   git tag -a vX.Y.Z-rc.N origin/main -m "Textus X.Y.Z-rc.N"
   git push origin vX.Y.Z-rc.N
   ```

Release notes aren't required for a pre-release: the fragments stay in
`docs/releases/next/` until the stable release collects them.

### A release (`vX.Y.Z`)

1. On `main`, set the version to `X.Y.Z` as in step 1 above, and collect
   the release notes: `node scripts/release-notes.mjs build X.Y.Z` adds
   every fragment in `docs/releases/next/` to `docs/releases/X.Y.Z.md`
   (creating it in the outline of [TEMPLATE.md](../releases/TEMPLATE.md)
   if it doesn't exist), each bullet at the end of its section, oldest
   first, and deletes the fragments. Then edit the file: write the summary
   sentence, merge bullets that describe one change, order each section.
   The release workflow refuses a stable tag without the notes, and
   `check-versions.mjs --tag` (step 3, and the workflow's preflight) a
   stable tag with fragments left over or the summary unwritten; the notes
   are the GitHub release's text and the updater's.
2. Open one pull request into `stable`, titled `Textus X.Y.Z`, from a
   release branch made from `main`, and squash-merge it once CI passes.
   Each earlier release was squashed into `stable`, so `main` and `stable`
   share no recent history and a pull request straight from `main`
   conflicts. The release branch records `stable` as merged and keeps
   `main`'s content (nothing lands on `stable` but releases, so there is
   nothing of its own to keep):

   ```sh
   git fetch origin
   git checkout -b release/vX.Y.Z origin/main
   git merge -s ours origin/stable -m "Merge stable into the X.Y.Z release"
   git diff origin/main --stat   # empty: the content is main's
   git push -u origin release/vX.Y.Z
   ```

3. Check the merged `stable` and tag that exact commit:

   ```sh
   git fetch origin
   node scripts/check-versions.mjs --tag vX.Y.Z   # on a checkout of origin/stable
   git tag -a vX.Y.Z origin/stable -m "Textus X.Y.Z"
   git push origin vX.Y.Z
   ```

   Tag only after the merge has landed: a tag pushed before it points at the
   old commit, and the workflow's preflight stops it.

4. `release.yml` runs, as for every tag (below).

### What the workflow does

1. `release.yml` checks that the tag matches the version files and that CI
   (`check`, `e2e`, `native`) passed on the tagged commit - it waits if CI is
   still running, and stops if it failed, so the builds don't run the tests
   again. A pull request runs macOS, Windows and the iOS build only for
   platform code, so this run after the merge is the first to run all of
   them: before tagging, look at it whole, `e2e-webkit` and `ios` included,
   which the gate doesn't wait for. A flaky job is rerun alone
   (`gh run rerun <run> --failed`); a real failure is fixed on `main`,
   brought to `stable` again, and the unpublished tag moved to the new
   commit. Run `npm run test:perf` once and compare its numbers with the
   last release's: a reference, not a gate. Then it builds,
   signs and notarizes for macOS (Apple silicon and Intel), Windows and Linux
   (x64 and ARM64 each; see [Installers](#installers)),
   writes the updater manifest onto the draft, publishes the GitHub release,
   points the beta channel's manifest at it, mirrors the
   installers to the website's download bucket, and sends the tested
   `textus-bin` package to the `[catvinci]` pacman repository in
   `CatVinci-Studio/arch-repo` (see `packaging/arch/README.md`).

   The Homebrew cask is not ours to update: it is the official
   [`textus` cask](https://github.com/Homebrew/homebrew-cask/blob/main/Casks/t/textus.rb)
   (`Casks/t/textus.rb` in `Homebrew/homebrew-cask`), and Homebrew's bot
   bumps it after each stable release, usually within a few hours.

2. Verify the release:
   - the GitHub release is public and has every file in
     [Installers](#installers), and a `.sig` beside each one with updater
     keys;
   - `latest.json` is still Levis 0.9.8's and `textus-latest.json` has the new
     version with the keys listed there (`jq '.platforms | keys'`):
     `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `linux-aarch64`,
     `windows-x86_64` and `windows-aarch64`, each also with its installer
     suffix;
   - <https://textus.md/download/manifest.json> names the new
     files under all ten keys, `windows-arm64`, `linux-arm64`, `deb-arm64`
     and `rpm-arm64` included;
   - <https://textus.md/download/textus-beta.json> has the new
     version;
   - the Arch repository has `textus-bin-X.Y.Z-1`;
   - later that day, `brew info --cask textus` shows the new version. If
     Homebrew's bot hasn't bumped it after a day, open the bump pull
     request by hand with `brew bump-cask-pr textus --version X.Y.Z`.

A failed run can be rebuilt with
`gh workflow run release.yml --ref vX.Y.Z -f tag=vX.Y.Z`: the workflows, the
preflight checks and the Arch package's scripts (`packaging/arch/`) come from
the ref; the app, its installers and tarball, and the updater manifest are
built from the tag. The ref is the tag because the **release** environment
admits only tags ([Secrets](#secrets)). The three steps after publishing are
separate workflows, so one of them can be retried alone:
`gh workflow run mirror-downloads.yml --ref vX.Y.Z -f tag=vX.Y.Z`, and the
same for `update-beta-manifest.yml` and `update-arch-repo.yml`.

## Installers

Each release carries these, named by tauri-bundler (`X.Y.Z` is the
version). The files with updater keys have a `.sig` beside them, and the
updater manifest (`textus-latest.json`) points those keys at them; the
download mirror's `manifest.json` gives the website one file per mirror
key. A pre-release has no `.rpm`, and so no `…-rpm` keys.

| Platform          | File                                    | Built on           | Updater keys                  | Mirror key      |
| ----------------- | --------------------------------------- | ------------------ | ----------------------------- | --------------- |
| macOS, Apple      | `Textus_X.Y.Z_aarch64.dmg`              | `macos-26`         | -                             | `mac`           |
| macOS, Apple      | `Textus_X.Y.Z_aarch64.app.tar.gz`       | `macos-26`         | `darwin-aarch64`, `…-app`     | -               |
| macOS, Intel      | `Textus_X.Y.Z_x64.dmg`                  | `macos-26` (cross) | -                             | `mac-intel`     |
| macOS, Intel      | `Textus_X.Y.Z_x64.app.tar.gz`           | `macos-26` (cross) | `darwin-x86_64`, `…-app`      | -               |
| Windows x64       | `Textus_X.Y.Z_x64-setup.exe`            | `windows-latest`   | `windows-x86_64`, `…-nsis`    | `windows`       |
| Windows ARM64     | `Textus_X.Y.Z_arm64-setup.exe`          | `windows-11-arm`   | `windows-aarch64`, `…-nsis`   | `windows-arm64` |
| Linux x64         | `Textus_X.Y.Z_amd64.AppImage`           | `ubuntu-22.04`     | `linux-x86_64`, `…-appimage`  | `linux`         |
| Linux x64         | `Textus_X.Y.Z_amd64.deb`                | `ubuntu-22.04`     | `linux-x86_64-deb`            | `deb`           |
| Linux x64         | `Textus-X.Y.Z-1.x86_64.rpm`             | `ubuntu-22.04`     | `linux-x86_64-rpm`            | `rpm`           |
| Linux ARM64       | `Textus_X.Y.Z_aarch64.AppImage`         | `ubuntu-22.04-arm` | `linux-aarch64`, `…-appimage` | `linux-arm64`   |
| Linux ARM64       | `Textus_X.Y.Z_arm64.deb`                | `ubuntu-22.04-arm` | `linux-aarch64-deb`           | `deb-arm64`     |
| Linux ARM64       | `Textus-X.Y.Z-1.aarch64.rpm`            | `ubuntu-22.04-arm` | `linux-aarch64-rpm`           | `rpm-arm64`     |
| Arch Linux x86_64 | `Textus_X.Y.Z_linux_x86_64.tar.gz`      | `ubuntu-22.04`     | -                             | -               |
| Arch Linux x86_64 | `textus-bin-X.Y.Z-1-x86_64.pkg.tar.zst` | Arch container     | -                             | -               |

ARM64 Windows and Linux ship from 1.1.0 on, built on GitHub's native arm64
runners. The Arch package stays x86_64: it is built and tested in the
x86_64-only `archlinux` container, and `[catvinci]` has no aarch64
repository. `scripts/updater-manifest.mjs` (`platformKeys`) and
`scripts/mirror-keys.mjs` map the file names to the keys; their tests
list every name above.

## Pre-releases

A tag with a semver pre-release suffix (`v1.3.10-rc.1`; the 1.3.0 test
builds were `v1.3.0-beta.N`) is published as a GitHub pre-release. The
version files carry the same suffix (`1.3.10-rc.1`):
the tag check compares the whole version, and release notes are only
required for stable tags. Linux (x64 and ARM64) gets the `.deb` and AppImage but no `.rpm`
(RPM versions can't contain `-`).

A pre-release reaches only the users who chose **Settings › General ›
About Textus › Update channel › Beta**. It skips the download mirror and
the `[catvinci]` pacman repository, and the stable channel never sees it: that channel reads
`releases/latest/download/textus-latest.json`, and `releases/latest`
excludes pre-releases. To check a pre-release before tagging the
stable release, switch a test install to Beta and use **Check for Updates**.

## Update channels

The app has two (`src-tauri/src/commands/update.rs`):

- **Stable** reads the newest stable GitHub release's `textus-latest.json`,
  the endpoint in `tauri.conf.json`.
- **Beta** reads `textus-beta.json` from the website's download bucket
  (<https://textus.md/download/textus-beta.json>), and falls back
  to the stable endpoint when that fails. GitHub has no fixed URL for the
  newest pre-release, so the beta manifest lives on our own bucket.

After every published tag, pre-releases included, the
`update-beta-manifest` job (`update-beta-manifest.yml`,
`scripts/update-beta-manifest.sh`) copies that release's
`textus-latest.json` to `textus-beta.json` in the `textus-downloads` R2
bucket - unless the bucket already holds a newer version, so rebuilding an
old tag never moves beta backwards. Beta therefore always offers the newest
of the latest pre-release and the latest stable release: on
`1.1.0-rc.2`, the stable `1.1.0` arrives as an update. Its download URLs are
the GitHub release's assets; pre-releases are not mirrored. It needs
the `CLOUDFLARE_API_TOKEN` secret that the download mirror uses.

The app never installs an older version than it runs, so a user who goes
back from Beta to Stable keeps the pre-release until a newer stable
version is out. An install from the `.rpm` skips pre-releases, which
have no `.rpm`, and waits for the stable release. Builds that don't install
their own updates (the Arch package, iOS) have no channel setting and check
the stable channel.

## Updater manifest

Textus's manifest is `textus-latest.json`, never `latest.json`. Levis 0.9.x
installs read `latest.json` from this repository (the old
`CatVinci-Studio/Levis` URL redirects here) and trust the same signing key, so
a `latest.json` on a Textus release would install Textus over Levis.
tauri-action runs with `uploadUpdaterJson: false` (`includeUpdaterJson`
before tauri-action 1.0); before publishing, the publish job writes
`textus-latest.json` from the draft's `.sig` files
(`scripts/updater-manifest.mjs build`) and refuses to publish a draft that
has a `latest.json` at all (`… guard`).

Releases up to 1.1.0 carried a copy of Levis 0.9.8's own `latest.json`, so
Levis installs updated to that last Levis, which told its user about Textus.
Levis support ended after 1.1.0: later releases carry no copy, and once one
of them is "Latest" a Levis install finds no manifest and stays as it is. The
name stays forbidden for the reason above. A rebuild of a 1.1.0-or-older tag
stops at the guard until that copy is deleted from its release.

`npm run check` runs `… check`, which
fails if the updater endpoint, the beta channel's endpoint or the workflow
drifts back. The beta manifest is `textus-beta.json` and lives only on the
download bucket, never on a GitHub release.

## Secrets

The signing, notarizing, upload and deploy secrets live in the repository's
**release** environment (Settings › Environments › release), not in the
repository's own secrets: `APPLE_*`, `TAURI_SIGNING_PRIVATE_KEY`,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_PLAYGROUND_TOKEN` and
`ARCH_REPO_DEPLOY_KEY`. The jobs that use them (`release.yml` build,
`ios-release.yml`, `mirror-downloads.yml`, `update-beta-manifest.yml`,
`update-arch-repo.yml`, `deploy-playground.yml`) name the environment, and it
admits only `v*` and `ios-v*` tags. So a job run by hand - a retried mirror,
a rebuilt Arch package - is started from the release's tag, not from main:

```sh
gh workflow run mirror-downloads.yml --ref v1.3.2 -f tag=v1.3.2
```

A copy of each secret is kept off GitHub by the maintainer.

## Rebuilds

Running the Release workflow by hand on an existing tag rebuilds and
republishes that release. The download mirror and the pacman repository
only move when the tag is the newest stable one, and the
beta manifest only when the tag is not older than the one it names, so
rebuilding an old tag never downgrades anyone.

## Windows installer

Windows ships only the NSIS installer (`-setup.exe`), for stable and
pre-release tags alike - the target list lives in
`src-tauri/tauri.windows.conf.json`. See
[windows-installer.md](windows-installer.md) for why MSI is not built.
