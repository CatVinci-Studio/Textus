# The Windows installer

What ships on Windows, what the user is asked, and how to change any of it.
Every rule here is enforced by a file that is named, so this document can be
checked against reality.

## One artifact

Windows gets the NSIS `.exe` and nothing else. `bundle.targets` in
`src-tauri/tauri.windows.conf.json` says so, which means a local
`npm run tauri build` produces exactly what CI publishes.

The MSI target used to be built alongside it on stable tags. That is what
made upgrades ask to uninstall first: the two installers register themselves
in different places and neither recognises the other's copy, so a user who
took the `.msi` once could not be upgraded by an `.exe` afterwards. MSI also
refuses to build a pre-release version at all, so `-rc` tags were NSIS-only
regardless, and the in-app updater has always downloaded NSIS. One installer,
one upgrade path.

Anyone still running an MSI-installed copy is detected and offered the
uninstall (see _Upgrading_ below); that is the one case the extra page is
still worth showing.

## The pages, in order

Four, and only four. Agreed deliberately - shorter was on the table and the
install-location page was kept.

| #   | Page             | What it is for                                               |
| --- | ---------------- | ------------------------------------------------------------ |
| 1   | Welcome          | The branded sidebar. No decisions.                           |
| 2   | Install location | Defaults to `%LOCALAPPDATA%\Textus`; changeable.             |
| 3   | Progress         | Advances to the finish page by itself when the copy is done. |
| 4   | Finish           | "Create a desktop shortcut" and "Run Textus" checkboxes.     |

Pages that exist in the stock Tauri template and are deliberately **not**
shown:

- **License** - none is configured (`bundle.licenseFile` is unset).
- **Install mode** (per-user vs per-machine) - `installMode` is fixed to
  `currentUser`, so there is nothing to ask and no UAC prompt.
- **Start menu folder** - unset, so the shortcut goes straight into Programs.
- **Reinstall / uninstall-first** - see below.

The wording of all four is NSIS's own, which means it follows the operating
system's language, not the app's. Bundled (`nsis.languages`) are the ten
the app itself offers: English, Simplified and Traditional Chinese, Japanese,
Korean, Spanish, French, German, Russian and Portuguese (NSIS's Brazilian
`PortugueseBR`; NSIS falls back to it for any Portuguese system, as it does
to Spanish for every Spanish region).

## Upgrading

Installing over an existing copy asks nothing. The installer writes over the
old version in place, which is exactly what an in-app update does, so both
routes to a new version behave the same way.

Stock Tauri instead shows a page offering "uninstall before installing" or
"do not uninstall". That page is skipped for a same-version reinstall and for
an upgrade, and kept for:

- a **downgrade**, where being told the installed version is newer is the
  whole point, and
- a **WiX/MSI install**, which this installer cannot overwrite - it has to
  run the old uninstaller first, and needs the user's consent to do it.

## Changing things

**The artwork** - `src-tauri/installer/header.bmp` (150x57, top strip) and
`sidebar.bmp` (164x314, welcome and finish pages). Both are drawn by
`scripts/make-installer-art.py` from the app icon and the brand palette; edit
the script and re-run it rather than editing the bitmaps:

```sh
python3 scripts/make-installer-art.py
```

NSIS reads BMP and only BMP, at those exact sizes - anything else is
stretched to fit and looks it.

**The icons and page images** - `bundle.windows.nsis` in
`src-tauri/tauri.windows.conf.json`.

**The pages themselves** - `src-tauri/installer/installer.nsi`. This is
tauri-bundler's own template, vendored (from tauri-cli v2.11.4) because the
two changes above are to `Page` declarations and no config option reaches
them; `installerHooks` only reaches the four install/uninstall macros. It is
upstream **verbatim** apart from the blocks marked `; Textus:`, so re-syncing
after a CLI upgrade is a diff against that tag's copy of
`crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi` plus re-applying
those blocks.

## Known rough edge

The publisher shown in Add/Remove Programs is `chengaoshen`, derived from the
bundle identifier because `bundle.publisher` is unset. Setting it would read
better, but it also moves the registry key the installer remembers a custom
install location under, and breaks the fingerprint used to detect an old MSI
install - so it is left alone until there are no MSI installs left to
migrate.
