# {name}

{description}

A plugin for [Textus](https://textus.catvinci.com).

## Install

Download `{id}-<version>.zip` from this repository's
[releases](../../releases), then in Textus choose **Settings › Extensions ›
Plugins › Install from file…** and pick it.

## Use

Say here what it does and how to reach it, in a few lines: Textus shows
this README on the plugin's page, before it is installed and after. Add
`README.zh.md` and so on for other languages.

## Publish a new version

1. Change `version` in `textus-plugin.json` (for example to `0.2.0`).
2. Commit, then tag the commit with the same version and push the tag:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

The release workflow (`.github/workflows/release.yml`) zips the plugin and
publishes it as a release. To have it listed in Textus, see
[LISTING.md](https://github.com/CatVinci-Studio/textus-plugins/blob/main/LISTING.md).
