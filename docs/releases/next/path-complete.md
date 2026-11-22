### New

- Typing a link's or a picture's target, `[text](` or `![alt](`, lists the open folder's files by their path from the document, in the rich editor and in source mode: a picture lists only images, a link every file with notes first. Picking one writes the path as Textus writes link paths (a space as `%20`). (#777)
- **Insert Link** in a file's right-click menu in the sidebar puts a link to it at the caret of the document in use, in the folder's link style; an image goes in as a picture. (#777)

### Fixed

- Markdown put in at the caret (**Insert at cursor** on an AI reply, a snippet, a file Shift-dragged from the sidebar) now reaches the document in source mode and split view too, and is one undo step of its own. A Shift-dragged image goes in as a picture rather than a link.
