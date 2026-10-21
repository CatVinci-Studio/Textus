### Improved

- Makes completion suggestions shorter and more often right: only the next few words you are sure to write, up to the end of the clause, offered when you pause after a word - also in the middle of a document, where it now leads into the text after the caret. Right after a full stop or a comma, and in an empty paragraph, it waits for you; "Continue writing" still asks. Fewer requests go out (a pause of 0.8 seconds, less text sent), so completion costs less.

### Fixed

- Stops completion from doubling the half-typed Chinese or Japanese word at the cursor (十分 + 分钟 read 十分分钟), a comma the text already ends with, or opening with an ellipsis.
