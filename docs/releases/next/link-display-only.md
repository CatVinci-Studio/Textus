### Improved

- Links work like every other piece of Markdown: the caret on a link shows its source, elsewhere it reads as its text, and only the display changes. Undo and redo work right after looking at a link, a link is saved exactly as you wrote it (bare URLs stay bare), and bold or code inside a link's text is drawn as such.
- A link's text is its Markdown, so deleting the word inside bold in a link leaves its `****` behind, and Find also matches words in a link's hidden address, showing that link's source.
- A bare web address with text typed right against it is saved as `[address](address)`, so it opens again as the same link.
