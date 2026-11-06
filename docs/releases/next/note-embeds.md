### New

- `![[Note]]`, `![[Note#Heading]]` and `![[Note#^block]]` show the note, section or block in place, read-only, when a plugin such as Two-way Links draws them: up to five embeds deep, never in a loop, redrawn when the note is saved. Click it to edit its source; click its title to open the note there.
- Links to notes that don't exist yet are dimmed, as in Obsidian. A click still creates the note.
- `[[` inserts links as the folder writes them: in an Obsidian vault, with its new-link format (shortest, relative or absolute).
- For plugins: `metadata.linkTo` writes the link Textus would write, `files.blockId` gives a block its `^id`, `views.registerEmbed` draws `![[...]]` embeds, hover cards on a `#^block` link get the block, and `metadata` links say whether they were wiki links.
