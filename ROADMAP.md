# Roadmap

[简体中文](ROADMAP.zh.md) · Updated with every release. Last: 1.4.4.

No dates on purpose: we're a small team and ship when it's good. What's
already out is in the [release notes](docs/releases/).

## 1.4.4 (being finished)

- **Plugin API 1.8**, first part: plugins add export formats, right-click
  menus, blocks and snippets to the `/` menu, margin marks, problems with
  one-click fixes, inline completion, display-only syntax, margin comments,
  and use your AI model with your consent.
- **Heading folding**, and an **Excalidraw** plugin.
- **Motion and dragging**: blocks dragged as themselves while the others
  make room, also into a document open beside; smooth scrolling; table
  rows and columns that open up and glide into place.
- **Custom AI endpoints** that list their models to pick from, in Settings
  and in the chat.
  [#700](https://github.com/CatVinci-Studio/Textus/issues/700)
  [#701](https://github.com/CatVinci-Studio/Textus/issues/701)
  [#702](https://github.com/CatVinci-Studio/Textus/issues/702)
- **Speed with many formulas**: formulas, diagrams and embedded notes drawn
  only near what you are reading.
  [#710](https://github.com/CatVinci-Studio/Textus/issues/710)
- **Phones and tablets**: block handles by touch, the page running to the
  screen's bottom edge.
- **The look before 1.4** in reach: Appearance › Window Layout says how.

Then **iPhone and iPad on the App Store**; the
[TestFlight beta](https://testflight.apple.com/join/39s9nnzs) and the
Android APK until then.

## 1.4.5

- **Plugin API 1.8**, the rest: database views of a plugin's own, folders
  from other places (read and written), conventions of other apps' folders
  read, and AI answers streamed to plugins.
- **Remote folders over SSH**, as in VS Code: your `~/.ssh/config` and
  keys, nothing installed on the server.
- **Android**: search and databases across a folder opened through the
  Files app.

## Later

Everything else is decided by what people ask for: give an issue a 👍 to
move it up, or add a wish to the
[Wishlist](https://github.com/CatVinci-Studio/Textus/issues/196).

## Not in the core: plugins

The app stays lean. Outside services and less common syntax are plugins,
installed from **Settings › Plugins** and made in
[textus-plugins](https://github.com/CatVinci-Studio/textus-plugins).

Already plugins:

- outside services: Zotero, Openverse images, WakaTime, DeepSeek, Claude
  Code, Codex and OpenCode as agents;
- sync: Cloud Sync (WebDAV, S3, Nutstore);
- syntax and diagrams: LaTeX completion, ABC music, PlantUML, WaveDrom,
  Markmap, ECharts and Chart.js, function plots;
- ways of working: kanban, database, canvas, Excalidraw, daily notes,
  tasks, slides, Vim and Emacs keys, and more.

Not yet, and welcome as plugins: MkDocs / Zensical admonitions
([#220](https://github.com/CatVinci-Studio/Textus/issues/220)), Cisco IOS
highlighting ([#639](https://github.com/CatVinci-Studio/Textus/issues/639)).

## Want to help?

Pick an unclaimed
[good first issue](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee),
[help wanted](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22help+wanted%22+no%3Aassignee)
or [plugin idea](https://github.com/CatVinci-Studio/textus-plugins/issues?q=is%3Aopen+label%3A%22plugin+idea%22),
and read [CONTRIBUTING.md](CONTRIBUTING.md).
