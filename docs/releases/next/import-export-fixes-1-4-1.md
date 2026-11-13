### Fixed

- Opening or importing an RTF file keeps its list numbers (`3.`, `(3)`, `c)`, `iii.`, `三、`) instead of numbering every item 1, and a link to a place in the same RTF document is no longer broken. A PowerPoint numbered list keeps its start number and counts on.
- A Word picture with an empty description takes its title as alt text, and HTML inline code holding a double backtick keeps its text.
- Export finds Pandoc installed through Nix, conda or another login-shell PATH when Textus was opened from the Dock.
- Headings with the same name get distinct link targets even next to one named like a numbered copy (`Intro`, `Intro`, `Intro-1`). Headings, numbered headings and the suggested file name skip `<!-- -->` comments, as the editor does.
- A project's `.textus/settings.json` with comments or trailing commas can be changed from Textus.
- MCP: two tools whose names collide after the 64-character limit no longer get a name the model's API refuses (every request used to fail), and several servers still starting are waited for once, not one after another.
- Textus AI: a Claude reply cut off by the connection in the middle of an edit says the connection ended instead of sending an empty edit. A picture whose link spells spaces as `%20` is found, and library entries' `aliases:` written as a YAML list are read.
- `textus <plugin-tool> --json '{…}'` passes the JSON to the plugin's tool.
