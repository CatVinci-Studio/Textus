# {name}

{description}

A plugin for [Textus](https://textus.catvinci.com).

## Install

Download `{id}-<version>.zip` from this repository's
[releases](../../releases), then in Textus choose **Settings › Extensions ›
Plugins › Install from file…** and pick it.

## Use

See [USAGE.md](USAGE.md).

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
