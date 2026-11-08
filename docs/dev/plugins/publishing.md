# Publishing a plugin

How a plugin gets to people: its README and pictures, its version and
the Textus it needs, and the store.

## Versions

- `version` is the plugin's own, semver. A published version never
  changes: any change to what is packed - your files, or a shared file
  your package carries - is a new version.
- `engines.textus` is the Textus it needs, as a semver range
  (`">=1.3.10"`). Raise it to the version that added the newest API you
  call ([versions.md](versions.md)); a Textus outside it doesn't load the
  plugin, and the store tells the user to update Textus.
- `platforms` says where it runs (`["desktop"]`, or with `"ios"`).

## Its README

Put a `README.md` beside the manifest - and `README.zh.md`, `README.ja.md`
and so on for other languages. It is the plugin's page in the store:

1. `# Name`, then one sentence saying what it does.
2. Short paragraphs on what it can do and how to reach it (menu paths in
   bold), its settings and the permissions it asks for, and why.
3. `## Changes`: one line per version, newest first.

Every language says the same. **Get more** shows it on the plugin's page before it
is installed, and its page in Settings shows it after; Textus picks the
reader's language, English otherwise. The manifest's `icon` (an SVG or PNG)
is drawn beside its name on a tile of its own.

## Screenshots

Pictures of the plugin at work go in `screenshots/` beside its manifest,
PNGs in the order to show them. They aren't packed with the plugin: the
catalog lists them, and Get more shows the first on the plugin's card. Keep
them light - a window of about 1200 px, cropped to what the plugin does.

## Publishing

1. On the plugin's page in Settings (or the chat card of one Textus AI
   wrote), choose **Export for Publishing…**: your name as its publisher,
   and a folder. You get the plugin laid out as a repository - its id
   under your name, a README, an MIT LICENSE, a `.gitignore` and a release
   workflow.
2. Make that folder a GitHub repository and push a version tag
   (`git tag v0.1.0 && git push origin v0.1.0`). The workflow zips the
   tagged files as `<id>-<version>.zip` and publishes a release; anyone
   can install it with **Install from file…**.
3. To have it in **Get more** for everyone, open a pull request to
   textus-plugins adding `community/<id>.json` - your repository and the
   version. A review runs on it (the zip is your tagged source, byte for
   byte; its permissions; its code; what comes with it) and a maintainer
   tries it. [LISTING.md](https://github.com/CatVinci-Studio/textus-plugins/blob/main/LISTING.md)
   has the rules.

A new version is a new tag, and a pull request changing `version` in the
same file. A published version never changes.
