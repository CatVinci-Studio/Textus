# Releasing

Maintainers only. Releases are tags: the next minor version's on `main`,
the current stable version's fixes on `stable`. The desktop app ships from a `vX.Y.Z` tag through
`.github/workflows/release.yml`; the iOS app ships from an `ios-vX.Y.Z` tag
through `.github/workflows/ios-release.yml` (see [ios-release.md](ios-release.md)).
The browser playground isn't released: it deploys from `main` on every
change ([infrastructure.md](infrastructure.md#playground)).

## Branches

Two long-lived branches, each with its own tags:

| Branch   | What it is                                     | Tagged there                   |
| -------- | ---------------------------------------------- | ------------------------------ |
| `main`   | The next minor version: new features land here | `vX.Y.0-beta.N`, then `vX.Y.0` |
| `stable` | The version people have installed: fixes only  | `vX.Y.1`, `vX.Y.2`…            |

Everything else is short-lived and deleted on merge (the repository does
it):

| Branch                                 | For                                                                             | Merges into        |
| -------------------------------------- | ------------------------------------------------------------------------------- | ------------------ |
| `feat/…`, `fix/…`, `docs/…`, `chore/…` | One change                                                                      | `main` or `stable` |
| `feat/<name>` as an integration branch | A large feature built in several pull requests (below)                          | `main`             |
| `release/vX.Y.Z`                       | One release: the version bump and its notes, or a patch's fixes tested together | `main` or `stable` |

- Branch protection on `main` and `stable` requires the `check`, `e2e` and
  `native` CI jobs (and `ci-config`, which only a fork's pull request
  runs). It doesn't require the branch to be up to date: a pull request
  that passed is merged as it is, and the CI run after the merge catches
  the rare case where two changes only break together.
- **Betas, then the release.** A minor version is tried out as
  `vX.Y.0-beta.N`, tagged on `main` while its features land, and released
  as `vX.Y.0` when they hold up.
- **Fixes are patch releases**: `vX.Y.1`, `vX.Y.2`… from `stable`,
  released as they are, with no beta first.
- **A fix goes where the bug is.** One the stable version has is a pull
  request to `stable` (an outside contributor's goes to `main`, and is
  carried over); one only `main` has goes to `main`. New features never go
  to `stable`.
- **After every release from `stable`, merge it back into `main`**
  (a merge commit, not a cherry-pick), in a pull request of its own:
  keep `main`'s side of the version lines; where `main` has restructured
  the code a fix touches, carry the fix over by hand.
- **`stable` moves on at each minor release.** Once `vX.Y.0` is tagged on
  `main`, `stable` is fast-forwarded to that tag (it can be, since every
  patch was merged back), and the next fixes are `vX.Y.1`… The last patch
  of the line before stays as its tag (`v1.2.8`, `v1.1.2`; `v0.9.8` for
  Levis).
- **Integration branches.** A feature too large for one pull request
  (multiple panes, say) gets a `feat/<name>` branch from `main`; its steps
  are pull requests into that branch, `main` is merged into it at least
  weekly, and the finished feature is one pull request into `main`. Small
  features never need one.
- Small, unrelated fixes can share one branch and one pull request, one
  commit per fix, so CI runs once.

Both lines can release in the same week. A stable tag becomes GitHub's
"Latest" release - the one the updater, the website's downloads, Homebrew,
the mirror and the Arch repository follow - only when it is the highest
stable version (release.yml's "Is this the newest stable tag?"), and a
pre-release never does. The beta channel's manifest only moves
forward (`scripts/updater-manifest.mjs beta`): a `1.2.2` released after
`1.3.0-beta.1` leaves beta users on the beta, and reaches them
in the next one, through the merge back.

## Desktop release

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json`, then run `npm install --package-lock-only`
   and `cargo check` (in `src-tauri/`) so `package-lock.json` (both of its
   version fields) and `Cargo.lock` follow. `node scripts/check-versions.mjs`
   (part of `npm run check`) fails until all five files agree.
2. Collect the release notes: `node scripts/release-notes.mjs build X.Y.Z`
   adds every fragment in `docs/releases/next/` to `docs/releases/X.Y.Z.md`
   (creating it in the outline of [TEMPLATE.md](../releases/TEMPLATE.md)
   if it doesn't exist), each bullet at the end of its section, oldest
   first, and deletes the fragments. Then edit the file: write the summary
   sentence, merge bullets that describe one change, order each section.
   The release workflow refuses a stable tag without the notes, and
   `check-versions.mjs --tag` (step 4, and the workflow's preflight) a stable
   tag with fragments left over or the summary unwritten; the notes are the
   GitHub release's text and the updater's.
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

## A patch release from `stable`

The same steps as [Desktop release](#desktop-release), on `stable`
instead of `main`:

1. Each fix is a `fix/…` branch from `origin/stable` and a pull
   request to `stable`, with its release-note fragment. A fix sent
   to `main` that the stable version also needs is carried over in a
   branch of its own, its author credited (`Co-authored-by:`).
2. The version bump (`X.Y.Z`, its notes built from the fragments) is a
   `release/vX.Y.Z` branch and a pull request to `stable`.
3. Tag the merged line, after the same check:

   ```sh
   git fetch origin
   node scripts/check-versions.mjs --tag vX.Y.Z   # on a checkout of origin/stable
   git tag -a vX.Y.Z origin/stable -m "Textus X.Y.Z"
   git push origin vX.Y.Z
   ```

4. Verify it as any release.
5. Merge `stable` into `main` in a pull request
   (`chore: merge stable after vX.Y.Z`), keeping `main`'s version
   lines; the notes file `docs/releases/X.Y.Z.md` comes along.

## Pre-releases

A tag with a semver pre-release suffix (`v1.3.0-beta.1`; up to 1.2,
`v1.2.0-rc.1`) is published as a GitHub pre-release. The version files
carry the same suffix (`1.3.0-beta.1`):
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
  (<https://textus.catvinci.com/download/textus-beta.json>), and falls back
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
