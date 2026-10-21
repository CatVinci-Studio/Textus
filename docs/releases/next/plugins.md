### New

- Plugins. Settings › Plugins lists them, each with a switch, and asks before one is turned on for the permissions it needs, in plain words: reading the document in front, suggesting edits, reading or changing files in the open folder, the clipboard, a website. Each permission can be taken back there later, and one switch turns every plugin off.
- A plugin runs sealed off from Textus and your files: it can do only what you allowed, and an edit it makes to a document is a suggestion you accept or reject, like Textus AI's. A plugin that stops answering or keeps failing is turned off, and Textus says which and why.
- Plugins can add commands with their own shortcuts, items in the editor's right-click menu and in a new Plugins menu, sidebar tabs, settings, and tabs of their own - a file type they open, or a view.
- Install a plugin from a file (.textusplugin), or load a plugin folder you are writing; Reload picks up your changes. docs/dev/writing-plugins.md is the guide.
- Eleven official plugins come with Textus, each off until you turn it on:
  - PDF Viewer: PDFs in a tab, pages drawn as you reach them, text to select and copy.
  - Word Reader: Word documents as Word lays them out; Edit as Markdown turns one into a document of yours.
  - Image Viewer: pictures and SVG files in a tab, with zoom and an SVG's source.
  - Web View: web pages in a tab beside your notes.
  - Quick Notes: notes in the sidebar, jotted down from anywhere (⌘⌥N / Ctrl+Alt+N), to insert or open later.
  - Calendar & Daily Notes: a calendar in the sidebar and a note for each day (⌘⌥D / Ctrl+Alt+D for today's).
  - Tasks: every task in the open folder in one list, ticked off there.
  - Kanban: boards of cards in lists, kept as Markdown files (name.kanban.md).
  - Version History: each save kept as a version, compared with the text now and brought back as a suggestion.
  - Zotero: cite from your Zotero library as you write (⌘⌥C / Ctrl+Alt+C).
  - Graph View: your notes and the links between them as a graph, for the whole folder or around the document in front.
