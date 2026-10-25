### New

- Plugins can read every Markdown document in the open folder in one call, `textus.workspace.readDocuments()`, and search their lines with `textus.workspace.search(query)`; Graph View and Tasks use it, so a large folder fills them much sooner than read a file at a time.
- Plugins open a file as a Markdown document, even one whose type a plugin's editor takes, with `textus.window.openFile(path, { asDocument: true })`, in place of the `textus.openAsDocument` command; a plugin's own view may open the file it shows without asking for the folder.
