### New

- `%%comments%%` are hidden while the caret is elsewhere, and show again when you move into them; a line that is all comment folds away.
- A block id at the end of a paragraph (` ^abc123`) is dimmed while the caret is elsewhere.
- Inline footnotes `^[note]` draw as small raised notes, and highlights that open with a colour emoji (`==🔴…==`, 🟠 🟡 🟢 🔵 🟣) take that colour.

### Fixed

- An inline footnote `^[note]` is no longer saved as `^\[note]` after you edit its paragraph, which Obsidian and Pandoc no longer read as a footnote.
