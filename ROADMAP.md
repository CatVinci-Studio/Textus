# Roadmap

[简体中文](ROADMAP.zh.md)

This is what we're working on and what we'd like to do next. There are no
dates here on purpose: we're a small team, and we'd rather ship something when
it's good than when a calendar says so.

Each item has an issue tagged
[`roadmap`](https://github.com/CatVinci-Studio/Textus/labels/roadmap). If one
of them matters to you, say so there - it really does change what we pick up
first.

## What we're working on now

**Getting onto the App Store.** Textus for iPhone and iPad has been in
TestFlight for a while and is about to go to review.
[#87](https://github.com/CatVinci-Studio/Textus/issues/87)

## In the next release (1.1.0)

- **Three ways to work with Textus AI.** **Write** drafts new text into
  your document without changing what is there, **Review** answers and leaves
  notes in the margin, and **Revise** suggests changes, sentence by sentence;
  every change is still yours to accept or reject.
  [#179](https://github.com/CatVinci-Studio/Textus/pull/179)
- **Textus AI remembers.** Tell it something that should hold beyond one
  request - a spelling, a tone, a character's details - and it keeps it, for
  this project or for all your work. You can see, edit and delete everything
  it remembers. [#180](https://github.com/CatVinci-Studio/Textus/pull/180)
- **Themes made in the chat.** Type `/theme`, describe the look you want, and
  switch to it with one click.
- **A new first-run tour** on reading notes about a classic in your language:
  type each Markdown mark, connect your AI, then write, review and revise your
  own notes with it. Skip the AI and the lessons are still there, with an
  animation to watch. [#90](https://github.com/CatVinci-Studio/Textus/issues/90)
- **Native ARM64 builds** for Windows (Snapdragon laptops) and Linux.
- **Set Textus as your default Markdown editor** from Settings.
  [#183](https://github.com/CatVinci-Studio/Textus/issues/183)
- **More HTML in your documents.** Collapsible `<details>` blocks, HTML
  tables, a few inline styles (colour, size, alignment) and inline `<svg>`
  drawings show as they should while you write, in split view and in
  exports. Scripts never run.
- **A beta channel.** Choose Beta under **Settings › General › About Textus**
  to get release candidates before everyone else; Stable stays the default.
- **Autosave**, if you turn it on: documents go back to their file as you
  write. [#133](https://github.com/CatVinci-Studio/Textus/issues/133)
- **Themes from the gallery, inside the app**: browse, install and update
  them in Settings. [#89](https://github.com/CatVinci-Studio/Textus/issues/89)
- **Obsidian image embeds** (`![[image.png]]`), kept as written when you
  save. [#135](https://github.com/CatVinci-Studio/Textus/issues/135)
- **A switch to type closing `*` yourself.**
  [#136](https://github.com/CatVinci-Studio/Textus/issues/136)
- **Your choice of image folder, or an image host.** Pasted images can go to
  a subfolder (`assets` unless you name another), next to the document, or be
  uploaded through PicGo, SM.MS or Imgur.
  [#147](https://github.com/CatVinci-Studio/Textus/issues/147)

New features come in minor releases like this one; patch releases (1.1.x)
only fix things.

## Recently done

- **Textus 1.0.4**: drag the sidebar to any width
  ([#77](https://github.com/CatVinci-Studio/Textus/issues/77)), PDFs on white
  with proper margins and optional page numbers
  ([#68](https://github.com/CatVinci-Studio/Textus/issues/68)), drop a file
  to open it on Windows
  ([#78](https://github.com/CatVinci-Studio/Textus/issues/78)), sharper
  Source Code Mode on Linux
  ([#61](https://github.com/CatVinci-Studio/Textus/issues/61)), and smaller
  installers.
- **The Playground** is live at
  [textus.catvinci.com/playground](https://textus.catvinci.com/playground/):
  try the editor in your browser before installing anything.
  [#88](https://github.com/CatVinci-Studio/Textus/issues/88)
- **Theme sharing** is open: post your theme as a comment on one pinned issue;
  once one of us has looked it over, it shows up on
  [textus.catvinci.com/themes](https://textus.catvinci.com/themes/) for
  everyone, free. [#89](https://github.com/CatVinci-Studio/Textus/issues/89)

## Later

- **Quick notes from anywhere.** A small Markdown window that opens with a
  global shortcut: jot a few lines, close it, and they are saved.
  [#193](https://github.com/CatVinci-Studio/Textus/issues/193)
- **Images made by Textus AI.** Ask for an illustration or a diagram while
  you write, and accept it into your document like any other suggestion.
  [#194](https://github.com/CatVinci-Studio/Textus/issues/194)
- **Voice input**, into the document or the message box for Textus AI.
  [#195](https://github.com/CatVinci-Studio/Textus/issues/195)
- An outline that covers a whole folder, not just one file.
  [#79](https://github.com/CatVinci-Studio/Textus/issues/79)

## Want to help?

Issues tagged
[`good first issue`](https://github.com/CatVinci-Studio/Textus/labels/good%20first%20issue)
are a good way in. If you have an idea that isn't here, add it to the
[wishlist](https://github.com/CatVinci-Studio/Textus/issues/196), or give a 👍
to one that's already there - we read all of them, and the most wanted ones
come here. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to build
Textus and send a pull request.
