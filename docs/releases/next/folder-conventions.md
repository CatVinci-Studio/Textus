### Improved

- Textus notices where another app keeps a folder's pictures - an Obsidian vault, a Logseq graph, a Foam, VS Code or Dendron workspace - and offers that folder on a card at the bottom right. Nothing changes until you choose Adopt, which saves it in the folder's `.textus/settings.json`, where it stays with the project. A document's own front matter (Typora's `typora-copy-images-to`) still decides for that document.
- `/img/a.png` opens from a site's static folder in MkDocs, Hugo, Docusaurus, Jekyll and Quarto sites, and wikilinks are found in the vault or graph the document is in.
- A project's `.textus/settings.json` can set its pictures folder, link style and line breaks by hand under `"conventions"`; they stand over Textus's own settings for that folder.
- For plugin developers: `textus.files.conventions(path?)` and `onDidChangeConventions` give the settings that apply in a folder (and, under `detected`, another app's not yet adopted), so a plugin never reads `.obsidian/` or other apps' settings itself.
