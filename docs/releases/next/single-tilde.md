### New

- **Settings › Editing › One tilde each side, ~text~** chooses what one tilde means: a subscript after a letter or digit (`H~2~O`, the default), a strikethrough as on GitHub, or the tildes as typed. Two tildes, `~~text~~`, always strike out; a document that struck text out with one tilde each side shows it as subscript or plain text now, unless you choose strikethrough here. Files are saved as written whichever is chosen; the editor, Textus AI's replies, the split view and Pandoc export all read it the same way.

### Fixed

- A range written with tildes, such as `40.30~40.45 = **64.0~64.2%**` or `5~10人，20~30人`, no longer turns into a strikethrough that also breaks the bold after it. (#756)
