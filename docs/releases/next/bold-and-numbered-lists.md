### Fixed

- Bold, italic, strikethrough or highlight on a selection that already holds some of it now formats all of the selection: the formatting inside merges into one span, and a span the selection cuts is taken in whole. Before, the shortcut did nothing.
- Backspace at the start of a numbered item takes its number away: the item becomes text between two lists, and the items after it start again from 1. Before, it joined the item above and the numbers ran on.
