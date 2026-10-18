# textus-bin and the [catvinci] pacman repository

`PKGBUILD` repackages `Textus_<version>_linux_x86_64.tar.gz`, which
`.github/workflows/release.yml` attaches to every GitHub Release. That
binary is built with `TEXTUS_DISTRIBUTION=aur`
(`src-tauri/src/distribution.rs`): it reports new versions, but the upgrade
goes through pacman.

The package is x86_64 only, although the release also builds Linux for
ARM64: the checks below run in the `archlinux` container, which has no
aarch64 image, and `[catvinci]` has no aarch64 repository. ARM64 Arch users
can use the AppImage.

## How users get it

Through the signed `[catvinci]` pacman repository,
[CatVinci-Studio/arch-repo](https://github.com/CatVinci-Studio/arch-repo).
Its README has the user setup and owns the signing key.

## What CI does

1. `release.yml` calls `.github/workflows/arch-package.yml` while the
   release is still a draft. In an `archlinux:base-devel` container,
   `ci-check.sh`:
   1. Installs `textus-bin` from `[catvinci]` as it is now (the previous
      release), with the same steps a user runs. Before the first Textus
      release reaches the repository it holds only `levis-bin` (Levis,
      Textus's name before 1.0.0), and that is installed instead.
   2. Builds the new package from the release tarball and upgrades to it.
      Over `levis-bin` it upgrades with `pacman -Syu` from a local
      repository holding the new package - `replaces=('levis-bin')` only
      acts on a sync upgrade - and checks that `levis-bin` and
      `/usr/bin/levis` are gone.
   3. Checks the libraries, the desktop entry, a 15 s start under Xvfb,
      and that `pacman -R` leaves no files behind.

   The workflow then attaches the package, `PKGBUILD` and `SRCINFO` to the
   draft. If any step fails, the release stays a draft.
2. After the release is published, `update-arch-repo.yml` commits
   `packages/textus-bin.json` (version, URL, sha256) to arch-repo with the
   `ARCH_REPO_DEPLOY_KEY` deploy key. arch-repo's Sync workflow signs the
   package and updates `catvinci.db`.

Pre-releases are built and tested, but never sent to arch-repo: pacman sorts
`0.9.0_rc.1` above `0.9.0`.

To retry one tag, run Actions > Arch package or Actions > Update arch-repo
with that tag.

## The AUR

`PKGBUILD` is also a valid AUR `PKGBUILD`. To publish `textus-bin` there
later: register an AUR account, then push the `PKGBUILD` and `SRCINFO`
(renamed to `.SRCINFO`) that each release carries to
`ssh://aur@aur.archlinux.org/textus-bin.git`.
