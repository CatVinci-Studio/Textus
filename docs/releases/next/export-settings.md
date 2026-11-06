### New

- Settings › Editor & Appearance › Export can add a table of contents and numbered headings to Word, EPUB and other Pandoc exports, numbered as the Heading Numbers plugin numbers them, and a bibliography: pick a .bib file (and a .csl style if you like) and `[@key]` citations become references.
- Settings › Editor & Appearance › Advanced takes your own Pandoc arguments for Word, LaTeX, EPUB, ODT or every format. They are passed word by word, never through a shell; `--from`, `--to` and `--output` stay with Textus. A failed export shows Pandoc's whole message and where these settings are.

### Fixed

- Pandoc exports turn `[[links]]` into readable links, put `![[pictures]]` into the file, give Obsidian callouts their titles, leave `%%comments%%` out, and keep `H~2~O`, `x^2^` and `~text~` as the editor shows them.
- HTML and PDF exports make `[[links]]` clickable and leave `%%comments%%` out, even the one the caret was on.
