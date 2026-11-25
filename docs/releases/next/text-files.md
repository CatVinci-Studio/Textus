### Fixed

- A text file that isn't a document (`.tex`, `.bib`, `.yaml`) shows as its own text, coloured as its language, instead of being read as Markdown with its lines run together.

### New

- Plugins can open a file type as plain text to edit in the source editor, coloured as a code language: `contributes.textFiles` (plugin API 1.11). The new TeX plugin uses it for LaTeX and BibTeX files.
