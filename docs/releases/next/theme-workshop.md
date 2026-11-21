### New

- Make your theme, above the themes list in Appearance and in Extensions › Themes, opens a theme workshop that works without Textus AI. Pick a theme you have to start from, then set its text, heading and code fonts (searchable, from the fonts on your computer), text size, heading scale, line height, line width, paragraph spacing and first-line indent in number fields, and pick a page palette and a code palette (each in light and dark). A sample page with headings, Chinese and Latin text, a list, a quote, code, a table and a formula shows the result as you go. Make Theme saves it under Installed Themes with your name for it and switches to it, the fonts Textus serves from their files going with it; the window around the document keeps the starting theme's colours, and your own text settings still apply over it.
- Every installed theme has Edit in Workshop. A theme made in the workshop reopens as you left it and can be saved over or as a new theme; any other theme (from the store, imported, or written by the AI) is a starting point for a new one. A theme card in Create's conversation has Keep editing in the workshop, and the workshop's Continue with AI takes your theme into the conversation.
- An installed theme's ⋯ has Export…, which saves that theme's own files (its dark file beside it as `name-dark.css`); Import CSS… reads both back, so an exported theme imports as it was, workshop settings included. The old export is now called Export Current Look as CSS…, and Delete moved into the same ⋯.

### Improved

- A theme from the AI may now set the text column's width (`#write { max-width }`), as Typora themes do. When you pick a text width or turn on first-line indent in Settings, it applies over a theme's.
- A theme that sets its text width (`#write { max-width }`) now gets exactly that width, as in Typora: the editor's margins go around it instead of coming out of it, so such themes' text is about 40 px wider than before.
