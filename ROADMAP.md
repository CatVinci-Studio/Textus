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

Textus AI that can do more, an editor that feels better, and a lot of fixes.

- **Open a whole folder** in the sidebar and search its file names with
  `Ctrl/⌘ + Shift + O`.
  [#152](https://github.com/CatVinci-Studio/Textus/issues/152),
  [#79](https://github.com/CatVinci-Studio/Textus/issues/79)
- **Saving changes only what you edited.** Every paragraph you didn't touch
  is written back exactly as it was, so a file you also keep in Git shows a
  small diff. Wikilinks (`[[Note]]`, `[[Note#Heading]]`) open the note, and
  they and `#tags` are kept as written.
  [#234](https://github.com/CatVinci-Studio/Textus/pull/234)
- **Revise, change by change, as it streams in.** Each changed sentence
  appears in its place, with its card in the margin and the count in the
  review bar growing as Textus AI writes.
  [#243](https://github.com/CatVinci-Studio/Textus/pull/243)
- **Diagrams Textus AI draws build up as it writes them**, and show before
  you accept them. [#254](https://github.com/CatVinci-Studio/Textus/pull/254)
- **Textus AI reads more of your project folder**: long files a part at a
  time, Word, PDF, slide and spreadsheet files, and images with a model that
  can see; it finds files by name and skips what `.gitignore` leaves out.
- **Web search for Textus AI** with every AI provider, with numbered sources
  you can check, as footnotes if you like.
- **A deep-thinking button** beside the web-search one.
- **Images made by Textus AI**, as suggestions you accept, with the major
  Chinese and international image providers.
  [#194](https://github.com/CatVinci-Studio/Textus/issues/194)
- **Textus AI learns from the revisions you reject**, and offers to remember
  what you keep turning down.
- **Doubao (Volcengine)** as an AI provider.
- **Long documents** that open, scroll and take typing smoothly.
- **Accessibility**: screen readers, full keyboard use and high contrast.
- **Textus in the background**, if you turn it on, with an icon in the
  notification area, the system tray or the menu bar.
  [#244](https://github.com/CatVinci-Studio/Textus/pull/244)
- **Links to headings in other files** open at that heading
  ([#233](https://github.com/CatVinci-Studio/Textus/pull/233)), and
  documents reopen where you left off
  ([#218](https://github.com/CatVinci-Studio/Textus/issues/218)).
- **More shortcuts**, an **interface text size**, a **Copy** button and line
  numbers for code blocks, **colour swatches** beside colour codes, and a
  choice of **diagram engine** (Mermaid, or the faster Pele).
  [#214](https://github.com/CatVinci-Studio/Textus/issues/214),
  [#150](https://github.com/CatVinci-Studio/Textus/issues/150),
  [#146](https://github.com/CatVinci-Studio/Textus/issues/146),
  [#242](https://github.com/CatVinci-Studio/Textus/pull/242)

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

## Later: Textus 1.3.0, plugins

- **Plugins, a plugin gallery and an MCP gallery**, and Textus AI can write
  a plugin for you. What every plugin has to keep to:
  - It runs in a sandbox and gets only the permissions you grant when you
    install it - reading or writing a folder, the network - and asks again
    if an update wants more.
  - Nothing runs unless you install it, and one switch turns every plugin
    off, leaving Textus as if none were there.
  - A plugin that fails or slows Textus down is turned off by itself and
    tells you why.
  - Textus AI uses a plugin only if you allow it, and only to read or to
    propose: a change to your document is a suggestion you accept, as now.
  - Plugins in the gallery are looked over by one of us before they appear,
    like themes, and one that turns out to be harmful can be taken down.
- **A first batch of plugins**: quick notes from anywhere
  ([#193](https://github.com/CatVinci-Studio/Textus/issues/193)), version
  history for your documents, SVG and PDF viewers, an image viewer, a
  calendar and daily notes, tasks, and a kanban board.
- **A second version of the plugin API**, shaped by what the first plugins
  need.
- **Smoother motion** throughout: animations, scrolling and panels that keep
  up on every platform.

## Want to help?

Issues tagged
[`good first issue`](https://github.com/CatVinci-Studio/Textus/labels/good%20first%20issue)
are a good way in. If you have an idea that isn't here, add it to the
[wishlist](https://github.com/CatVinci-Studio/Textus/issues/196), or give a 👍
to one that's already there - we read all of them, and the most wanted ones
come here. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to build
Textus and send a pull request.
