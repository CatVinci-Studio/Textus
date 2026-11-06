### New

- Updates the links to a file you rename or move in the sidebar, and the moved document's own links, so they keep working: at once inside an Obsidian vault, after asking everywhere else.
- Follows an Obsidian vault's attachment folder and new-link format for pictures you paste, and Typora's `typora-copy-images-to`, without ever changing the vault's or the document's settings.
- Shows a single line break as a break in the split view's preview and in Pandoc exports inside an Obsidian vault, unless the vault has **Strict line breaks** on.

### Improved

- Says in the sidebar when the file tree only follows the current document, with **Open as Folder** to make it the window's folder; **Close Folder** then also closes that folder's saved documents.
- Dims the files and folders a `.gitignore` leaves out, and build folders such as `node_modules`, in the file tree, as the file search already leaves them out.

### Fixed

- Shows files that Git, Obsidian or a file manager added, moved or deleted as soon as you come back to the window, without pressing **Refresh**.
- Renaming a note through a plugin no longer changes links that lead to another note with the same name, or rewrites `/docs/a.md` as a relative path.
