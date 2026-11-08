### Improved

- The whole interface grows with Interface Text Size and with a wide window: controls, icons, padding, corners, Settings, plugin pages and floating views (the desk pet, the pomodoro) together, not only the text.
- The sidebar and the AI panel keep their width in proportion as the interface grows, and narrow in a small window so the document always keeps room.
- The sidebar's, the tab bar's and the AI panel's header rows end on one line, and the panels' edges run up to the window's top.
- Everything you drag - tabs, files, plugin rows, cards - lifts the same way under the pointer.
- A plugin block in a document (a database, a board) is at most 70% of the window's height and scrolls inside, so the note around it stays in view.
- A link's path shows `%20` as a space, in the document, in source mode and in hover cards; the file keeps the standard `%20`, a run of escapes moves and deletes as one character, and a space you type in a link's path is saved as `%20`.

### Fixed

- Opening a recent project from the start page brings back the tabs you left it with; a project you haven't worked in opens its last document or its README, and otherwise shows its files and asks you to pick one, instead of looking untouched.
- In source mode, an undo pressed right after an edit (a pasted picture, say) is no longer undone again a moment later.
- In a small window the AI panel narrows so the document keeps its room, and can still be dragged; its edge now starts under the title bar instead of cutting through the word count and window buttons.
- Plugin pages' own styles grow with the interface too, without any change to the plugins.
- The Plugins menu has each plugin's Settings…, opening its page in Settings.
- A setting's row no longer changes when you click its words or its description, only its switch; a plugin's name on its page no longer turns it off.
