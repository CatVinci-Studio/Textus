### Fixed

- Typing a link with its address in angle brackets, such as `[a](<b>)`, makes the link instead of repeating its first characters (`[a[a](<b>)`). Typing a link, image, footnote or HTML tag around raw HTML or a bold span no longer repeats text either, and typing `)` just after raw HTML no longer loses it.
