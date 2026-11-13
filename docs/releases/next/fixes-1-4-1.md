### Improved

- Claude Code, Codex, OpenCode and other agents can be set from their menu in the chat: their mode, model and effort, as each offers them, remembered per agent. They still start in the mode that asks before each change, where the agent has one; a mode chosen that doesn't ask, such as Bypass permissions, is shown by name beside the agent while it is on. OpenCode has no such mode and starts in its own build mode. Typing `/` lists the agent's own commands.
- An agent's steps read at a glance: an icon for each kind (reading, searching, running a command, editing), its output a click on the step itself, paths inside the folder shortened, several reads and searches in a row folded into one line, and its plan shown as a checklist while it works.
- A long Claude Code, Codex or Textus AI session uses far less memory and work as it runs: replies reach the window in batches instead of a message a word, an agent's steps come without the whole files and outputs the chat never shows, only the reply being written redraws as it comes in, and a very long conversation draws its newest part, with the earlier ones a click away.
- Textus keeps as much loaded as the computer's memory allows: on a machine with little memory, or when the system runs short, pages out of sight are let go sooner and caches are given back at once.
- The file tree stays quick in a big folder: coming back to the window, or Textus AI writing a file, redraws only the rows that changed.
- Plugins that read the folder's notes (Two-way Links, Tasks, Tags, Graph, databases) get only what changed since they last asked, instead of every note at each save.
- Pictures in a document load as they come near the screen, and switching between long documents does less work.

- A plugin's block in a document can draw at the interface's text size, so a wider column shows more of it: Wiki bases and task queries now do, rather than growing with the document's text and zoom.
- Switching back to a long document you edited is quicker: its undo history comes back without drawing the whole document again.
- Only the tab in front keeps a source or split view: tabs behind it let theirs go after a while, as plugin pages do.
- In a narrow Plugins list, a plugin with an update keeps its row on one line, with a plain Update button.
- `Ctrl/⌘ + N`, File › New and the sidebar open a document beside Textus AI and Settings, never among their tabs.

### Fixed

- Updating and relaunching Textus writes its windows, tabs, settings and AI chats first, so nothing from the last moments before the update is lost.
- A picture embedded the Obsidian way (`![[image.png]]`) stays on show when clicked, as any picture does: its corner button or a double click enlarges it, and right-click offers View Image and Copy. The source comes up as the caret reaches it. (#659)
- Reopening Textus brings its documents back as they were, the one in front first, without flicking through each tab.
- Codex starts in Read-only, its mode that asks before changes, rather than Workspace access.
- `Tab` in source mode indents instead of leaving the document, and `Shift + Tab` takes an indent back; press `Esc` first to move on with `Tab`. (#652)
- A draft recovered after a crash asks before it is saved over a file that changed since its edits began, and a draft whose file can't be found comes back untitled instead of being dropped.
- Updating Textus closes its windows as Quit does, asking about unsaved documents or keeping them as drafts, before the new version starts.
- A tab dragged into another window no longer leaves an old copy to come back as a recovered draft.
- A web page opened in a tab can't read files on your computer, and Textus AI's replies load no pictures from the web as they show.
- A rewrite Textus AI is typing into a document finishes even when you switch to another AI tab; closing an AI tab mid-reply keeps what it wrote and marks the files it changed.
- Reopening another document's conversation from History, with no folder open, shows that conversation.
- Stop ends Claude Code or Codex while it is still starting or signing in.
- After Ctrl+Tab, closing a tab or opening a new one, typing goes to the tab in front.
- A file or folder moved to the Trash in the sidebar or by a plugin lets its tabs go: an unchanged one closes, an edited one stays as an unsaved draft.
- A picture pasted or dropped into a document shows in the file tree at once.
- A grammar card left open after an edit fixes only its own underline.
- `Ctrl/⌘ + F` with the Settings tab in front searches Settings, and Escape or Enter while an input method is composing a word stays the input method's in Find and Settings.
- A settings file brings along a built-in theme in use, and an imported theme whose dark look didn't come with it keeps one look.
- An imported theme shows at once, its web fonts following when they load, also after starting offline.
- An imported theme that uses older variable names no longer flashes its colours in at every start.
- Remembering a rule Textus AI already knows no longer says it failed.
- Plugin pages for Traditional Chinese read English where a plugin has no Traditional Chinese, never Simplified; German speaks with du and French with vous throughout.
- A diagram inside a quote or list no longer moves the pictures of the diagrams after it in a Word, OpenDocument or EPUB export.
- An HTML page saved beside its document shows pictures named from the folder's root (`/assets/x.png`), and links `[[#Heading]]` to its heading.
- A search hit or a plugin's link to a line opens at that line in a document with front matter, lists or extra blank lines.
- Plain-text `.txt` notes are searched too.
- Cut, Copy and Paste in a plugin's own right-click menu (Quick Notes, a Wiki base's cell) work, and Cut never removes text it couldn't copy.
- Ticking a nested row in a plugin's list shows at once.
- `textus open ./notes.md` and `textus export ./notes.md` use the tab already open for that file.
- Signing out while Textus AI refreshes a sign-in keeps you signed out, and signing in again keeps the new account.
- Starting an MCP server or external agent for the first time no longer holds up other work.
- A file moved, renamed or put in the Trash in one window shows in every other window too, and their tabs follow it.
- Heading numbers show in a document open beside another, not only in the one you are typing in.

### Platform notes

- **Linux:** menus, Settings and dialogs no longer flash as they open (#640), web pages use less memory, and a web page tab out of sight is let go after a while.
- **Windows:** Claude Code, Codex and MCP servers started with `npx` start; a name with `:` (`Meeting 10:30`) is refused instead of making a hidden stream; Textus AI's edits keep a file's Windows line endings; Export no longer flashes a console window and finds Pandoc where its installer puts it; F5, `Ctrl + R` and `Ctrl + P` no longer reload or print the window from Find or a new name in the sidebar; the menu bar's Undo, Redo and Select All act where you were typing.
- **Obsidian vaults:** Vim reads `.obsidian.vimrc` and WakaTime reads `.wakatime-project` and the Git branch again; Zotero puts literature notes in the folder, and makes them from the template, that the vault's Zotero Integration or Citations plugin is set to.
