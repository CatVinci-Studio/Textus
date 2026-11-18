### New

- For plugin authors: `textus.files.registerConventionReader` reads the folder settings of an app Textus doesn't read itself. Textus finds the app's marker file and hands it to the plugin; what the plugin reads is used like any other app's settings.
- A new official plugin, Logseq Folders, now reads a Logseq graph's settings: links by page name, the journals folder and its date format, and where new pages go. Textus itself still recognises a Logseq graph, so wikilinks are found from it without the plugin, and suggests the plugin once when a graph is opened.
