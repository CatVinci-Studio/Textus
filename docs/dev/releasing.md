# Releasing

Maintainers only. Releases are tags on `main`: there is no release branch to
merge first. The desktop app ships from a `vX.Y.Z` tag through
`.github/workflows/release.yml`; the iOS app ships from an `ios-vX.Y.Z` tag
through `.github/workflows/ios-release.yml` (see [ios-release.md](ios-release.md)).

## Branches

- `main` is the only working branch. Every change is a short-lived branch
  (`feat/…`, `fix/…`, `docs/…`, `chore/…`) and a pull request to `main`.
  Branch protection requires the `check`, `e2e` and `native` CI jobs. It
  doesn't require the branch to be up to date with `main`: a pull request
  that passed is merged as it is, and the CI run on `main` after the merge
  catches the rare case where two changes only break together.
- Small, unrelated fixes for a patch release can share one branch and one
  pull request, one commit per fix, so CI runs once.
- Large features that are not ready stay on their own branch until they are.
- `release/X.Y.x` exists only when a fix must ship while `main` holds
  unreleased work: branch it from the last tag, fix, tag, then merge it back
  into `main` and delete it.
- `archive/levis` holds the last Levis code (v0.9.8).

## Desktop release

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json`, then run `npm install --package-lock-only`
   and `cargo check` (in `src-tauri/`) so `package-lock.json` (both of its
   version fields) and `Cargo.lock` follow. `node scripts/check-versions.mjs`
   (part of `npm run check`) fails until all five files agree.
2. Write the release notes in `docs/releases/X.Y.Z.md`, starting from
   [TEMPLATE.md](../releases/TEMPLATE.md). The release workflow refuses a
   stable tag without them, and uses them as the GitHub release's text.
3. Commit as `chore: bump version to X.Y.Z` in a pull request and merge it.
4. Check the merged `main` and tag that exact commit:

   ```sh
   git fetch origin
   node scripts/check-versions.mjs --tag vX.Y.Z   # run on a checkout of origin/main
   git tag -a vX.Y.Z origin/main -m "Textus X.Y.Z"
   git push origin vX.Y.Z
   ```

   Tag only after the merge has landed: a tag pushed before it points at the
   old commit, and the workflow's preflight stops it.

5. `release.yml` checks that the tag matches the version files and that CI
   (`check`, `e2e`, `native`) passed on the tagged commit - it waits if CI is
   still running, and stops if it failed, so the builds don't run the tests
   again. Then it builds,
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

6. Verify the release:
   - the GitHub release is public and has every file in
     [Installers](#installers), and a `.sig` beside each one with updater
     keys;
   - `latest.json` is still Levis 0.9.8's and `textus-latest.json` has the new
     version with the keys listed there (`jq '.platforms | keys'`):
     `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `linux-aarch64`,
     `windows-x86_64` and `windows-aarch64`, each also with its installer
     suffix;
   - <https://textus.catvinci.com/download/manifest.json> names the new
     files under all ten keys, `windows-arm64`, `linux-arm64`, `deb-arm64`
     and `rpm-arm64` included;
   - <https://textus.catvinci.com/download/textus-beta.json> has the new
     version;
   - the Arch repository has `textus-bin-X.Y.Z-1`;
   - later that day, `brew info --cask textus` shows the new version. If
     Homebrew's bot hasn't bumped it after a day, open the bump pull
     request by hand with `brew bump-cask-pr textus --version X.Y.Z`.

A failed run can be rebuilt with
`gh workflow run release.yml --ref main -f tag=vX.Y.Z`: the workflows, the
preflight checks and the Arch package's scripts (`packaging/arch/`) come from
the ref; the app, its installers and tarball, and the updater manifest are
built from the tag. The three steps after
publishing are separate workflows, so one of them can be retried alone:
`gh workflow run mirror-downloads.yml -f tag=vX.Y.Z`, and the same for
`update-beta-manifest.yml` and `update-arch-repo.yml`.

## Installers

Each release carries these, named by tauri-bundler (`X.Y.Z` is the
version). The files with updater keys have a `.sig` beside them, and the
updater manifest (`textus-latest.json`) points those keys at them; the
download mirror's `manifest.json` gives the website one file per mirror
key. A release candidate has no `.rpm`, and so no `…-rpm` keys.

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

A tag with a semver pre-release suffix (`v1.1.0-rc.1`) is published as a
GitHub pre-release. The version files carry the same suffix (`1.1.0-rc.1`):
the tag check compares the whole version, and release notes are only
required for stable tags. Linux (x64 and ARM64) gets the `.deb` and AppImage but no `.rpm`
(RPM versions can't contain `-`).

A release candidate reaches only the users who chose **Settings › General ›
About Textus › Update channel › Beta**. It skips the download mirror and
the `[catvinci]` pacman repository, and the stable channel never sees it: that channel reads
`releases/latest/download/textus-latest.json`, and `releases/latest`
excludes pre-releases. To check a release candidate before tagging the
stable release, switch a test install to Beta and use **Check for Updates**.

## Update channels

The app has two (`src-tauri/src/commands/update.rs`):

- **Stable** reads the newest stable GitHub release's `textus-latest.json`,
  the endpoint in `tauri.conf.json`.
- **Beta** reads `textus-beta.json` from the website's download bucket
  (<https://textus.catvinci.com/download/textus-beta.json>), and falls back
  to the stable endpoint when that fails. GitHub has no fixed URL for the
  newest pre-release, so the beta manifest lives on our own bucket.

After every published tag, release candidates included, the
`update-beta-manifest` job (`update-beta-manifest.yml`,
`scripts/update-beta-manifest.sh`) copies that release's
`textus-latest.json` to `textus-beta.json` in the `textus-downloads` R2
bucket - unless the bucket already holds a newer version, so rebuilding an
old tag never moves beta backwards. Beta therefore always offers the newest
of the latest release candidate and the latest stable release: on
`1.1.0-rc.2`, the stable `1.1.0` arrives as an update. Its download URLs are
the GitHub release's assets; release candidates are not mirrored. It needs
the `CLOUDFLARE_API_TOKEN` secret that the download mirror uses.

The app never installs an older version than it runs, so a user who goes
back from Beta to Stable keeps the release candidate until a newer stable
version is out. An install from the `.rpm` skips release candidates, which
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
