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

## In the next release (1.2.0)

- **Quick notes from anywhere.** A small Markdown window that opens from the
  File menu, the tray or a global shortcut you turn on: jot a few lines, press
  `Esc`, and they are saved as a Markdown file, one per note or one per day.
  [#193](https://github.com/CatVinci-Studio/Textus/issues/193)
- **Textus in the background**, if you turn it on: it keeps running after you
  close its last window, with an icon in the notification area, the system
  tray or the menu bar, and can start at login.
  [#244](https://github.com/CatVinci-Studio/Textus/pull/244)
- **Open a whole folder** in the sidebar and search its file names with
  `Ctrl/⌘ + Shift + O`.
  [#152](https://github.com/CatVinci-Studio/Textus/issues/152),
  [#79](https://github.com/CatVinci-Studio/Textus/issues/79)
- **Saving changes only what you edited.** Every paragraph you didn't touch
  is written back exactly as it was, so a file you also keep in Git shows a
  small diff. Obsidian wikilinks (`[[Note]]`, `[[Note#Heading]]`) open the
  note, and they and `#tags` are kept as written.
  [#234](https://github.com/CatVinci-Studio/Textus/pull/234)
- **Revise, sentence by sentence, as it streams in.** Each changed sentence
  appears beside the one it rewrites, instead of the whole passage being
  struck first. [#243](https://github.com/CatVinci-Studio/Textus/pull/243)
- **Links to headings in other files** (`[see](notes.md#heading)`) open at
  that heading. [#233](https://github.com/CatVinci-Studio/Textus/pull/233)
- **Documents reopen where you left off**, with the caret where it was.
  [#218](https://github.com/CatVinci-Studio/Textus/issues/218)
- **More shortcuts**: next and previous tab, Heading 1 to 6 and Paragraph,
  and a list of the shortcuts that can't be changed.
  [#214](https://github.com/CatVinci-Studio/Textus/issues/214)
- **Interface text size**: make the sidebar, tabs, menus and the AI panel
  larger or smaller without zooming the document.
  [#150](https://github.com/CatVinci-Studio/Textus/issues/150)
- **Colour swatches** beside colour codes in inline code, and a **Copy**
  button and optional line numbers for code blocks.
  [#146](https://github.com/CatVinci-Studio/Textus/issues/146)
- **A choice of diagram engine.** Mermaid stays the default; Pele draws the
  same diagrams faster. [#242](https://github.com/CatVinci-Studio/Textus/pull/242)

New features come in minor releases like this one; patch releases (1.2.x)
only fix things.

## Recently done

- **Textus 1.1.0**: three ways to work with Textus AI - Write, Review and
  Revise ([#179](https://github.com/CatVinci-Studio/Textus/pull/179)) - and
  a Textus AI that remembers what you ask for
  ([#180](https://github.com/CatVinci-Studio/Textus/pull/180)), themes made
  in the chat, a new first-run tour
  ([#90](https://github.com/CatVinci-Studio/Textus/issues/90)), native ARM64
  builds for Windows and Linux, Textus as your default Markdown editor
  ([#183](https://github.com/CatVinci-Studio/Textus/issues/183)), more HTML
  in your documents, a beta channel, autosave
  ([#133](https://github.com/CatVinci-Studio/Textus/issues/133)), the theme
  gallery inside the app
  ([#89](https://github.com/CatVinci-Studio/Textus/issues/89)), Obsidian
  image embeds ([#135](https://github.com/CatVinci-Studio/Textus/issues/135))
  and your choice of image folder or image host
  ([#147](https://github.com/CatVinci-Studio/Textus/issues/147)).
- **Textus 1.1.1**: calmer revision highlights, a card in place of an image
  that can't be loaded, **Show in folder** for images, image widths other
  apps understand, and fixes for typed links and images
  ([#189](https://github.com/CatVinci-Studio/Textus/issues/189)), clicks in
  Typewriter Mode
  ([#217](https://github.com/CatVinci-Studio/Textus/issues/217)) and Open
  Recent ([#201](https://github.com/CatVinci-Studio/Textus/issues/201)).
- **The Playground** is live at
  [textus.catvinci.com/playground](https://textus.catvinci.com/playground/):
  try the editor in your browser before installing anything.
  [#88](https://github.com/CatVinci-Studio/Textus/issues/88)
- **Theme sharing** is open: post your theme as a comment on one pinned issue;
  once one of us has looked it over, it shows up on
  [textus.catvinci.com/themes](https://textus.catvinci.com/themes/) for
  everyone, free. [#89](https://github.com/CatVinci-Studio/Textus/issues/89)

## Later (1.3.0)

- **Images made by Textus AI.** Ask for an illustration or a diagram while
  you write, and accept it into your document like any other suggestion.
  [#194](https://github.com/CatVinci-Studio/Textus/issues/194)
- **Voice input**, into the document or the message box for Textus AI.
  [#195](https://github.com/CatVinci-Studio/Textus/issues/195)
- **Hints as you type LaTeX**: suggestions and completion for the commands in
  a formula. [#182](https://github.com/CatVinci-Studio/Textus/issues/182)
- **Sync through WebDAV**, to keep your documents on a server of your own.
- **Textus AI learns from what you accept and reject**: when you keep turning
  down the same kind of change, it offers to remember that.
- **MkDocs and Zensical documents** saved without breaking their own syntax.
  [#220](https://github.com/CatVinci-Studio/Textus/issues/220)

## Want to help?

Issues tagged
[`good first issue`](https://github.com/CatVinci-Studio/Textus/labels/good%20first%20issue)
are a good way in. If you have an idea that isn't here, add it to the
[wishlist](https://github.com/CatVinci-Studio/Textus/issues/196), or give a 👍
to one that's already there - we read all of them, and the most wanted ones
come here. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to build
Textus and send a pull request.
