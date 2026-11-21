### New

- **Settings › Editing › One newline inside a paragraph** chooses whether a single newline joins the lines into one, as CommonMark and Pandoc read it (the default, and how the editor has always shown it), or breaks the line, as GitHub comments and Obsidian do. The editor, the split view, HTML, PDF and Pandoc export all follow it, and a folder's own setting (an Obsidian vault's "Strict line breaks") comes first, so the editor in such a vault now shows the breaks its split view and Pandoc export already did. The file is never changed.

- GitHub's inline math form, ``$`x^2`$``, shows as a formula in the editor, the split view, Textus AI's replies and HTML and PDF export, and goes to Pandoc as `$x^2$`. The file keeps it as written. A dollar sign beside ordinary inline code, as in `` costs $`5` ``, stays as typed.

### Fixed

- Powers written with carets, such as `x^2+y^2`, `2^10,3^5` or `2^10和3^5`, stay as typed instead of turning part of the line into superscript. Superscripts such as `x^2^`, `1^st^ place`, `Na^+^Cl^-^` and `m^2^s^-2^` still show as before.
- A formula after a price, as in `costs $5, a $x$ thing`, is shown as a formula in the editor too, as Textus AI's replies already showed it; prices such as `$5 to $10` stay text.
- An emoji shortcode joined to a letter or digit, such as `:100:` in `10:100:00` or `:b:` in `a:b:c`, stays text instead of showing an emoji.
