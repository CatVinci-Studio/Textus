### Fixed

- `Tab` in source mode indents instead of leaving the document, and `Shift + Tab` takes an indent back; press `Esc` first to move on with `Tab`. (#652)
- A file or folder moved to the Trash in the sidebar lets its tabs go: an unchanged one closes, an edited one stays as an unsaved draft.
- A picture pasted or dropped into a document shows in the file tree at once.
- A grammar card left open after an edit fixes only its own underline, never the same words elsewhere.
- `Ctrl/⌘ + F` with the Settings tab in front searches Settings.
- A settings file brings along a built-in theme in use, and an imported theme whose dark look didn't come with it keeps one look instead of an empty dark one.
- A theme's or Custom CSS's web fonts load once the network is back, without a restart.
- An imported theme that uses older variable names no longer flashes its colours in at every start.
- A diagram inside a quote or list no longer moves the pictures of the diagrams after it in a Word, OpenDocument or EPUB export.
- An HTML export links `[[#Heading]]` to its heading.
- `textus open ./notes.md` and `textus export ./notes.md` use the tab already open for that file.
- Signing out while Textus AI refreshes a sign-in keeps you signed out.
- Starting an MCP server or external agent for the first time no longer holds up other work while Textus reads the login shell's PATH.

### Platform notes

- **Linux:** menus, Settings and dialogs no longer flash as they open. (#640)
