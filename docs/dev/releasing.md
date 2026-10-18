# Releasing

Maintainers only. Releases are tags on `main`: there is no release branch to
merge first. The desktop app ships from a `vX.Y.Z` tag through
`.github/workflows/release.yml`; the iOS app ships from an `ios-vX.Y.Z` tag
through `.github/workflows/ios-release.yml` (see [ios-release.md](ios-release.md)).

## Branches

- `main` is the only working branch. Every change is a short-lived branch
  (`feat/…`, `fix/…`, `docs/…`, `chore/…`) and a pull request to `main`.
  Branch protection requires the `check`, `e2e` and `native` CI jobs and an
  up-to-date branch.
- Large features that are not ready stay on their own branch until they are.
- `release/X.Y.x` exists only when a fix must ship while `main` holds
  unreleased work: branch it from the last tag, fix, tag, then merge it back
  into `main` and delete it.
- `dev` is a locked, read-only snapshot of the old integration branch.
  `archive/levis` holds the last Levis code (v0.9.8).

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
   signs and notarizes for macOS (Apple silicon and Intel), Windows and Linux,
   publishes the GitHub release, writes the updater manifest, points the
   beta channel's manifest at it, mirrors the
   installers to the website's download bucket, points the Homebrew cask at
   both DMGs, and sends the tested `textus-bin` package to the `[catvinci]`
   pacman repository in `CatVinci-Studio/arch-repo` (see
   `packaging/arch/README.md`).
6. Verify the release:
   - the GitHub release is public and has every installer and `.sig` file;
   - `latest.json` is still Levis 0.9.8's and `textus-latest.json` has the new
     version with `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64` and
     `windows-x86_64`;
   - the Homebrew cask (`CatVinci-Studio/homebrew-tap`) has the new version
     and both sha256 sums;
   - <https://textus.catvinci.com/download/manifest.json> names the new files;
   - <https://textus.catvinci.com/download/textus-beta.json> has the new
     version;
   - the Arch repository has `textus-bin-X.Y.Z-1`.

A failed run can be rebuilt with
`gh workflow run release.yml --ref main -f tag=vX.Y.Z`: the packaging
scripts come from the ref, the build from the tag. The four steps after
publishing are separate workflows, so one of them can be retried alone:
`gh workflow run mirror-downloads.yml -f tag=vX.Y.Z`, and the same for
`update-beta-manifest.yml`, `update-homebrew-tap.yml` and
`update-arch-repo.yml`.

## Pre-releases

A tag with a semver pre-release suffix (`v1.1.0-rc.1`) is published as a
GitHub pre-release. The version files carry the same suffix (`1.1.0-rc.1`):
the tag check compares the whole version, and release notes are only
required for stable tags. Linux gets the `.deb` and AppImage but no `.rpm`
(RPM versions can't contain `-`).

A release candidate reaches only the users who chose **Settings › General ›
About Textus › Update channel › Beta**. It skips the Homebrew cask, the
download mirror and the `[catvinci]` pacman repository, and the stable
channel never sees it: that channel reads
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
`1.0.5-rc.2`, the stable `1.0.5` arrives as an update. Its download URLs are
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
tauri-action runs with `uploadUpdaterJson: false` (`includeUpdaterJson` before tauri-action 1.0); the publish job writes
`textus-latest.json` from the draft's `.sig` files
(`scripts/updater-manifest.mjs build`) and refuses to publish a draft that
has any other `latest.json` (`… guard`). `npm run check` runs `… check`, which
fails if the updater endpoint, the beta channel's endpoint or the workflow
drifts back. The beta manifest is `textus-beta.json` and lives only on the
download bucket, never on a GitHub release.

## Rebuilds

Running the Release workflow by hand on an existing tag rebuilds and
republishes that release. The Homebrew cask, the download mirror and the
pacman repository only move when the tag is the newest stable one, and the
beta manifest only when the tag is not older than the one it names, so
rebuilding an old tag never downgrades anyone.

## Windows installer

Windows ships only the NSIS installer (`-setup.exe`), for stable and
pre-release tags alike - the target list lives in
`src-tauri/tauri.windows.conf.json`. See
[windows-installer.md](windows-installer.md) for why MSI is not built.
