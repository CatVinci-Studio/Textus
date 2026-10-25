### New

- LaTeX commands as you type a formula, with the LaTeX Completion plugin (Settings › Extensions › Get more): a backslash and the start of a command - `\fr`, `\alp` - lists the commands that begin so, each with what it draws, and Enter or Tab writes one with the caret inside its braces. (#358)
- Plugins can suggest completions as you type, in formulas or in the text, through `contributes.completions` and `textus.editor.registerCompletionProvider`; the list shows under the caret, and a plugin is asked only when what you typed matches its pattern.
