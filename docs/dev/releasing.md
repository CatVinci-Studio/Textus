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
   publishes the GitHub release, writes the updater manifest, mirrors the
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
   - the Arch repository has `textus-bin-X.Y.Z-1`.

A failed run can be rebuilt with
`gh workflow run release.yml --ref main -f tag=vX.Y.Z`: the packaging
scripts come from the ref, the build from the tag. The three steps after
publishing are separate workflows, so one of them can be retried alone:
`gh workflow run mirror-downloads.yml -f tag=vX.Y.Z`, and the same for
`update-homebrew-tap.yml` and `update-arch-repo.yml`.

## Pre-releases

A tag with a semver pre-release suffix (`v1.1.0-rc.1`) is published as a
GitHub pre-release. The version files carry the same suffix (`1.1.0-rc.1`):
the tag check compares the whole version, and release notes are only
required for stable tags. It skips the Homebrew cask, the download mirror and
the `[catvinci]` pacman repository, so it reaches nobody who did not go looking
for it - the in-app updater reads `releases/latest/download/textus-latest.json`,
and `releases/latest` excludes pre-releases.

## Updater manifest

Textus's manifest is `textus-latest.json`, never `latest.json`. Levis 0.9.x
installs read `latest.json` from this repository (the old
`CatVinci-Studio/Levis` URL redirects here) and trust the same signing key, so
a `latest.json` on a Textus release would install Textus over Levis.
tauri-action runs with `includeUpdaterJson: false`; the publish job writes
`textus-latest.json` from the draft's `.sig` files
(`scripts/updater-manifest.mjs build`) and refuses to publish a draft that
has any other `latest.json` (`… guard`). `npm run check` runs `… check`, which
fails if the updater endpoint or the workflow drifts back.

## Rebuilds

Running the Release workflow by hand on an existing tag rebuilds and
republishes that release. The Homebrew cask, the download mirror and the
pacman repository only move when the tag is the newest stable one, so
rebuilding an old tag never downgrades anyone.

## Windows installer

Windows ships only the NSIS installer (`-setup.exe`), for stable and
pre-release tags alike - the target list lives in
`src-tauri/tauri.windows.conf.json`. See
[windows-installer.md](windows-installer.md) for why MSI is not built.
