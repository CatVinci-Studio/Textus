### New

- **Settings › Editor › Press Enter twice to leave a code block**: turned off, Enter in a code block always adds a line; press Down on the last line, or Cmd+Enter (Ctrl+Enter), to leave it.
- Plugins can offer completions as you type in a code block, told the block's language: `contributes.completions` with `where: "code"` (plugin API 1.11).

### Fixed

- In a code block on a Mac, Cmd+Right stops at the end of the line instead of jumping to the start of the next one.
- In a code block on a Mac, Cmd+Up and Cmd+Down go to the block's first and last line; pressed again, to the document's.
- On a Mac, Home and End move to the start and end of the line, instead of putting a box character into a code block.
