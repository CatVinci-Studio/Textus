### New

- Updates the links to a file you rename or move in the sidebar, and the moved document's own links, so they keep working: at once inside an Obsidian vault, after asking everywhere else.
- Shows a single line break as a break in the split view's preview and in Pandoc exports when the project's `.textus/settings.json` turns line breaks on.

### Improved

- Says in the sidebar when the file tree only follows the current document, with **Open as Project** to make it the window's folder; **Close Project** then also closes that folder's saved documents.
- Dims the files and folders a `.gitignore` leaves out, and build folders such as `node_modules`, in the file tree, as the file search already leaves them out.

### Fixed

- Shows files that Git, Obsidian or a file manager added, moved or deleted as soon as you come back to the window, without pressing **Refresh**.
- Renaming a note through a plugin no longer changes links that lead to another note with the same name, or rewrites `/docs/a.md` as a relative path.
