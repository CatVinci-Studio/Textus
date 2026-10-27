### Fixed

- A pasted quote, code block or maths block keeps its shape wherever it lands: a quote that starts with a list (`> - item`) no longer comes in as the bare list, code pasted on an empty list item or into a line of text is no longer flattened into that line, and the rest of the line stays out of the code.
- A table pasted on a new line takes that line, instead of leaving an empty line above it; pasted into a table's cell, its cells fill the table from that cell on, adding rows and columns where it runs past the edge, instead of breaking the table in two.
