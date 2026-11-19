# Roadmap

[简体中文](ROADMAP.zh.md) · What comes next in Textus. What's already out
is in the [release notes](docs/releases/).

Textus is made by just a few people, and help is very welcome: a pull
request can be anything from fixing a typo to a whole feature, and many
of the features people ask for work best as plugins, which anyone can
write.

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
- **Heading fold arrows in the margin**, beside the block handle instead
  of inside the heading's text, so selecting, typing and exporting never
  meet them.
- **One rule for what loads late**: in a long document, blocks, formulas,
  diagrams, plugin frames and pictures draw as they come near; export,
  print, search and jumping to a heading all load the whole document by
  the same rule.
- **A full pass over the plugin API**, brought up to date in one go.
- **Smoother editing**: a review of typing, scrolling and dragging for
  any stalls, a better feel when dragging blocks, and interface polish.
- **Tab works the same everywhere**: in lists and to-dos it indents an
  item a level (Shift+Tab takes it back); in formulas and the properties
  at a document's top it indents as in a code block; in source mode it
  indents the whole list line. A completion suggestion still takes Tab
  first.
- **Select All on Windows and Linux** shows the same colour as any other
  selection.
- **Mermaid diagrams fold** like headings, to a single line.
- **Android**: search and databases across a whole folder opened through
  the Files app.
- **Textus on the App Store** for iPhone and iPad (a public beta on
  TestFlight comes first).
- **iPhone on its side** keeps clear of the camera only, with a little room
  at the rounded corner on the other side, and the tab row's + stays in
  one place.
- **Problems list on the Mac**: clicking a problem opens its card again.

## Want to help?

Open right now and waiting for someone to take them:

- **Plugins people asked for**:
  [MkDocs / Zensical support](https://github.com/CatVinci-Studio/Textus/issues/220),
  [Cisco IOS code highlighting](https://github.com/CatVinci-Studio/Textus/issues/639),
  [following a Foam workspace's settings](https://github.com/CatVinci-Studio/Textus/issues/724).
- **Phones**:
  [Android's Back steps through the app before leaving it](https://github.com/CatVinci-Studio/Textus/issues/725).
- **Small first pull requests**:
  [a worked example of `ai.stream` in the plugin guide](https://github.com/CatVinci-Studio/Textus/issues/726),
  [a tutorial for database views](https://github.com/CatVinci-Studio/Textus/issues/727),
  [the install check finding calls through a renamed namespace](https://github.com/CatVinci-Studio/Textus/issues/728).

Or pick another unclaimed
[good first issue](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee),
[help wanted](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22help+wanted%22+no%3Aassignee)
or [plugin idea](https://github.com/CatVinci-Studio/textus-plugins/issues?q=is%3Aopen+label%3A%22plugin+idea%22),
and read [CONTRIBUTING.md](CONTRIBUTING.md). Plugins are made in
[textus-plugins](https://github.com/CatVinci-Studio/textus-plugins). A
wish of your own goes in the
[Wishlist](https://github.com/CatVinci-Studio/Textus/issues/196); give an
issue a 👍 to move it up.
