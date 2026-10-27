### Fixed

- Backspace at the start of a code block, maths block or table, or Delete just before one, moves the caret there instead of pouring the block into the line beside it as plain text, or selecting the whole table so the next key replaced it. The line below the front matter no longer joins the front matter.
- Delete at the end of a line before a quote or list joins their text, as Backspace does, instead of taking the quote's or list's first line out of it; before a callout it moves into it, keeping the callout.
