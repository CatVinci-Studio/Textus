### Improved

- Textus follows how a folder is written, whichever app made it, not only Obsidian: Logseq graphs, Foam and VS Code workspaces, Dendron, MkDocs, Hugo, Docusaurus, Jekyll and Quarto sites, and git repositories. Links are written the way the folder writes them, pictures go where it keeps them, `/img/a.png` opens from a site's static folder, and a single newline shows as a line break where the folder says so. Nothing in those apps' settings is ever changed.
- A project's `.textus/settings.json` can set the same things under `"conventions"`, standing over what other apps say.

### For plugin developers

- `textus.files.conventions(path?)` and `onDidChangeConventions` give a folder's link style, `/` root, attachments, line breaks, templates folder, daily notes and new-note folder, so a plugin never reads `.obsidian/` or other apps' settings itself.
