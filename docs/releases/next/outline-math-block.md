### Fixed

- The outline no longer lists a line of a math block as a heading. A formula with a line of only `=` or `-` showed up as an extra heading, and every heading after it in the outline jumped to the next one. (#851)
- The outline lists the same headings as the document in more places: a `# line` inside an HTML block (`<div>`, `<details>`, `<pre>`, `<table>`, a script or style), inside a list item, a quote or a footnote, or a code block or formula left open in a list or quote no longer adds a heading or hides the ones after it. Numbered headings in a Pandoc export count the same headings, and now number `Title` / `===` headings too.
- Exporting with Pandoc (Word, PDF, HTML) keeps a display formula with a line of only `=`, `-` or `#` as one formula, instead of turning part of it into a heading and printing the rest as text.
- In Source Mode, clicking a heading in the outline (or in the outline menu on a phone) goes to that heading's line. Before, nothing happened, and the jump happened later when you switched back.
