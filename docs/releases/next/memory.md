### Improved

- Textus gives back memory it doesn't need: a document tab out of sight for ten minutes lets its editor go and opens again where it was, with its undo history, when you come back to it. A tab where Textus AI is working or changes wait to be decided stays as it is.
- Undo history now lasts past closing a document, as Vim's undo file does: open the same file again, unchanged, and Undo still steps back through your earlier edits. It is kept in Textus's own data folder for 30 days, follows files you rename in Textus, and old history is cleared once it passes 50 MB.
- A plugin's page in a tab you haven't looked at for five minutes, and a plugin's block far down a long document, are let go until you return to them; caches are cleared after ten minutes without use.
