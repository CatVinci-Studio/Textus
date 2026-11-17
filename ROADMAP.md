# Roadmap

[简体中文](ROADMAP.zh.md) · Updated with every minor release. Last: 1.4.3.

No dates on purpose: we're a small team and ship when it's good. What's
already out is in the [release notes](docs/releases/).

## Now (1.4.x)

- **Plugin API 1.8**: the plugin interface made whole, so others want to
  build on it - a list of block types the `/` menu reads, display-only
  syntax, margin icons, right-click menus, problems with one-click fixes,
  inline completion from plugins, plugins that use your AI model with your
  consent, export formats, database views and history sources.
- **Heading folding**, and an **Excalidraw** plugin.
- **Motion**: smooth scrolling, blocks and table rows that make room and
  settle, a gliding caret.
- **Custom AI endpoints** that list their models to pick from.
- **Phones and tablets**: block handles by touch, the content running to
  the screen's bottom edge.
- **Linux**: a roomier title bar.
  [#664](https://github.com/CatVinci-Studio/Textus/issues/664)
- **iPhone and iPad on the App Store**; TestFlight and the Android APK
  until then. [#87](https://github.com/CatVinci-Studio/Textus/issues/87)

## Next (1.5)

- **iPad with the desktop interface**, and the iPhone adapted from it.
- **Lighter windows**: one editor for each part of the window, documents
  kept as data, so many open tabs cost little memory.
- **Voice input.** [#195](https://github.com/CatVinci-Studio/Textus/issues/195)

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
- ways of working: kanban, database, canvas, daily notes, tasks, slides,
  Vim and Emacs keys, and more.

Not yet, and welcome as plugins: MkDocs / Zensical admonitions
([#220](https://github.com/CatVinci-Studio/Textus/issues/220)), Cisco IOS
highlighting ([#639](https://github.com/CatVinci-Studio/Textus/issues/639)).

## Want to help?

Pick an unclaimed
[good first issue](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee),
[help wanted](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22help+wanted%22+no%3Aassignee)
or [plugin idea](https://github.com/CatVinci-Studio/textus-plugins/issues?q=is%3Aopen+label%3A%22plugin+idea%22),
and read [CONTRIBUTING.md](CONTRIBUTING.md).
