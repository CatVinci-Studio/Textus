### Fixed

- Ctrl/⌘ + click on a link reaches more targets: `[[Note#^id]]`, `[[#^id]]` and `[t](Note.md#^id)` jump to the block, `[[Note#A#B]]` to heading B under A, `[[Note v1.2]]` opens the note, `[[file.pdf]]` and `[[image.png]]` open the file, `[t](Note)` works without `.md` and finds a note in another folder, and a link from `/` is read from the repository, vault or `typora-root-url` folder instead of the disk's root.
- A `^id` after a link's `#` is a block, never taken for a heading of that name.
- `[[Note\|alias]]` inside a table opens its note, and `[[Note|]]` shows as "Note".

### New

- Ctrl/⌘ + click on a wikilink to a note that doesn't exist yet creates it, where the Obsidian vault puts new notes or beside the document, and opens it.
