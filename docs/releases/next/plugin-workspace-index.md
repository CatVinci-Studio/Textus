### Plugins

- A plugin can read every Markdown document in the open folder in one call
  (`textus.workspace.readDocuments()`), and search their lines for words
  (`textus.workspace.search(query)`). Graph View and Tasks use it, so a
  large folder fills them much faster than one file at a time.
- `textus.window.openFile(path, { asDocument: true })` opens a file as a
  Markdown document even where a plugin's editor takes its type; it
  replaces the `textus.openAsDocument` command. A plugin's own view may
  open the file it shows without `workspace.read`.
