### Fixed

- Typing or editing a link that Markdown doesn't read as one, such as `[a](<b)` with its `<` never closed or `www.` followed by a comma, no longer freezes the editor until it runs out of memory once the caret moves on; it stays text, as it reads on reopening.
