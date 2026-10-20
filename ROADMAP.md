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

- **Textus in the background**, if you turn it on: it keeps running after you
  close its last window, with an icon in the notification area, the system
  tray or the menu bar.
  [#244](https://github.com/CatVinci-Studio/Textus/pull/244)
- **Open a whole folder** in the sidebar and search its file names with
  `Ctrl/⌘ + Shift + O`.
  [#152](https://github.com/CatVinci-Studio/Textus/issues/152),
  [#79](https://github.com/CatVinci-Studio/Textus/issues/79)
- **Saving changes only what you edited.** Every paragraph you didn't touch
  is written back exactly as it was, so a file you also keep in Git shows a
  small diff. Wikilinks (`[[Note]]`, `[[Note#Heading]]`) open the note, and
  they and `#tags` are kept as written.
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
  ([#89](https://github.com/CatVinci-Studio/Textus/issues/89)), image
  embeds written as `![[image.png]]` ([#135](https://github.com/CatVinci-Studio/Textus/issues/135))
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

## Later: Textus 1.3.0, a full expansion, experience first

- **Long documents** that open and scroll smoothly.
- **Web search for Textus AI** with every AI provider, with sources you can
  check.
- **A simple choice of how hard the AI thinks**: Auto, Fast or Deep.
- **Images made by Textus AI**, as suggestions you accept, with the major
  Chinese and international image providers.
  [#194](https://github.com/CatVinci-Studio/Textus/issues/194)
- **Textus AI reads Word, PDF, slide and spreadsheet files** in your project
  folder.
- **Plugins, and a plugin gallery.** Plugins run sandboxed with only the
  permissions you grant, and nothing runs unless you install it; Textus AI
  can write one for you. A few basic plugins come with the launch, among
  them **quick notes from anywhere**: a small Markdown window that opens
  from a global shortcut, saved as a Markdown file when you close it.
  [#193](https://github.com/CatVinci-Studio/Textus/issues/193)

## Later: Textus 1.4.0, steady and polished

- **Voice input**, taken slowly to get it right.
  [#195](https://github.com/CatVinci-Studio/Textus/issues/195)
- **Version history** for your documents: go back to an earlier version, and
  see what Textus AI changed.
- **Textus AI learns from the revisions you accept and reject.**
- **More plugins**: a second version of the plugin API, and official plugins
  for a calendar, tasks and a kanban board.
- **An image viewer.**
- **Accessibility**: screen readers, full keyboard use and high contrast.

## Want to help?

Issues tagged
[`good first issue`](https://github.com/CatVinci-Studio/Textus/labels/good%20first%20issue)
are a good way in. If you have an idea that isn't here, add it to the
[wishlist](https://github.com/CatVinci-Studio/Textus/issues/196), or give a 👍
to one that's already there - we read all of them, and the most wanted ones
come here. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to build
Textus and send a pull request.
