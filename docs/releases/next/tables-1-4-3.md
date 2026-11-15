### New

- Tables have tools at their top right while the cursor is in them: alignment, rows and columns, Copy and Delete. A small grid sets the number of rows and columns.
- Rows and columns have a grip on the table's edge: press it to pick the whole row or column, pull it to move it. Alt+arrow keys move them too, and Backspace takes out picked rows or columns.

### Improved

- Copying from a table gives other apps what they expect: a head row, lines and no stray paragraphs; Copy Table writes HTML too, and copied rows paste back in as new rows.
- A table's one row under its head row can be deleted, leaving the head alone as Markdown allows.

### Fixed

- A file changed by another app updates whole blocks when the change spans several lines, so a table is never split in two.
- A table pasted into a table undoes in one step, and rows copied as plain text (tab-separated) paste in as rows.
- A table pasted into a narrower table fills it from the cursor's cell and adds the columns it needs, instead of jumbling its cells.
- On iPhone and iPad, a pasted table undoes in one step, and a copied or cut row with empty cells at its end pastes in as a row.
- A table's row and column grips sit at the middle of their row and column when the document is zoomed or the table scrolled sideways.
- On iPhone and iPad, a long press at the left of a table's first column shows Paste instead of moving the cursor out of the table.
