# Roadmap

[简体中文](ROADMAP.zh.md) · What comes next in Textus. What's already out
is in the [release notes](docs/releases/).

Textus is made by just a few people, and help is very welcome: a pull
request can be anything from fixing a typo to a whole feature, and many
of the features people ask for work best as plugins, which anyone can
write.

## 1.4.5: fixes

- **Select All shows its highlight** again in a document that starts with
  a heading (on the Mac it selected everything but showed nothing).
- **Text font list**: every installed font is offered, Latin fonts included
  when Textus is in Chinese, Japanese or Korean, and Chinese fonts show
  their Chinese names too (微软雅黑 Microsoft YaHei).
- **The caret beside a picture** is as tall as the picture.
- **Picture viewer**: two fingers on a trackpad move the picture and a
  pinch zooms it, and a zoomed picture can no longer be pushed out of
  sight.
- **PDF export on the Mac** prints at the usual size (it printed about a
  third larger than on Windows).
- **Network proxy**: follows the system proxy by default, and moves to
  General, so plugins install behind a proxy even with Textus AI off.

## 1.4.6

- **Remote folders over SSH**, as in VS Code: open a folder on a server
  and write in it as in a local one, using your `~/.ssh/config` and keys,
  with nothing to install on the server.
- **Comments live with your files**: notes and tracked changes move into
  the folder's `.textus/`, so they travel with the folder (sync, Git) and
  can be shared; moving a file outside Textus no longer loses them.
  Existing ones move over as their documents are opened.
- **PDF print options**: paper size, margins, text size and page numbers.
- **More for plugins**: their own database views, folders from other
  places (the SSH folders above use it), other apps' folder layouts (such
  as Logseq), documents kept as folders (such as TextBundle), and AI
  answers that stream in as they are written.
- **Mermaid diagrams fold** like headings, to a single line.
- **Android**: search and databases across a whole folder opened through
  the Files app.

## Want to help?

Open right now and waiting for someone to take them:

- **Read through a translation** of the interface and fix what sounds
  wrong:
  [Japanese](https://github.com/CatVinci-Studio/Textus/issues/672),
  [Korean](https://github.com/CatVinci-Studio/Textus/issues/673),
  [French](https://github.com/CatVinci-Studio/Textus/issues/674),
  [German](https://github.com/CatVinci-Studio/Textus/issues/675),
  [Spanish](https://github.com/CatVinci-Studio/Textus/issues/676),
  [Portuguese](https://github.com/CatVinci-Studio/Textus/issues/677),
  [Russian](https://github.com/CatVinci-Studio/Textus/issues/678).
- **Small first pull requests**:
  [fix three broken links in the developer docs](https://github.com/CatVinci-Studio/Textus/issues/670),
  [tests for Roman numeral lists when importing Word documents](https://github.com/CatVinci-Studio/Textus/issues/671).
- **Plugins people asked for**:
  [MkDocs / Zensical admonitions](https://github.com/CatVinci-Studio/Textus/issues/220),
  [Cisco IOS code highlighting](https://github.com/CatVinci-Studio/Textus/issues/639).

Or pick another unclaimed
[good first issue](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee),
[help wanted](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22help+wanted%22+no%3Aassignee)
or [plugin idea](https://github.com/CatVinci-Studio/textus-plugins/issues?q=is%3Aopen+label%3A%22plugin+idea%22),
and read [CONTRIBUTING.md](CONTRIBUTING.md). Plugins are made in
[textus-plugins](https://github.com/CatVinci-Studio/textus-plugins). A
wish of your own goes in the
[Wishlist](https://github.com/CatVinci-Studio/Textus/issues/196); give an
issue a 👍 to move it up.
