# What Textus stores, and where

Everything the app remembers between launches, so that it can be backed up
and inspected - and so that Textus (Levis's name since 1.0.0, with a new
identifier) can import a Levis installation by copying files.

Up to 0.9.6 the settings and histories lived in the webview's localStorage.
That store belongs to the webview engine: it is keyed by app identifier and
kept in a different format on every platform (SQLite under WebKitGTK and
WKWebView, LevelDB under WebView2), so another app can't read it, and every
window wrote the whole settings object back on each change, so two windows
undid each other's changes. Since 0.9.7 they are plain JSON files owned by
Rust (`src-tauri/src/settings.rs`).

## Directories

The app identifier is `com.catvinci.textus`. Tauri's app directories:

| Platform | Config directory                                                        | Data directory                        |
| -------- | ----------------------------------------------------------------------- | ------------------------------------- |
| Linux    | `~/.config/com.catvinci.textus/`                                        | `~/.local/share/com.catvinci.textus/` |
| macOS    | `~/Library/Application Support/com.catvinci.textus/`                    | the same directory                    |
| Windows  | `%APPDATA%\com.catvinci.textus\`                                        | the same directory                    |
| iOS      | `Library/Application Support/com.catvinci.textus/` in the app container | the same directory                    |

(`$XDG_CONFIG_HOME` and `$XDG_DATA_HOME` move the Linux ones.)

## Files

Debug builds write `*.dev.json` instead of `*.json` for the three files
marked †, and use `chat-history.dev/` instead of `chat-history/`, so a
development build never rewrites an installed app's settings (the two share
an identifier, hence the directories).

### Config directory

| File                                                                                                | What                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings.json` †                                                                                   | Every setting in Settings, plus zoom and the onboarding flags: `{"schemaVersion": 1, "settings": {...}}`. Field names and meanings are the `Settings` interface in `src/settings/SettingsContext.tsx`.                                                                                                                                 |
| `prefs.json`                                                                                        | `editor_window_size`, written by Rust when an editor window closes. Also still holds `new_document_mode` and `restore_session_on_startup` from 0.9.6, no longer read after the first launch of 0.9.7.                                                                                                                                  |
| `session.json`                                                                                      | The documents each window had open, for session restore (desktop). Closing the last window leaves it as it was: the next launch reopens those documents, and so does the Dock icon on macOS, where the app keeps running windowless. Where the caret was in each is in `ui-state.json` (`lastCarets`, the last 50 documents, by path). |
| `recent_files.json`, `recent_folders.json`                                                          | File > Open Recent (desktop): the files, and the folders opened with File > Open Folder… listed above them.                                                                                                                                                                                                                            |
| `themes/<id>/light.css`, `dark.css`                                                                 | Imported themes, and themes installed from the theme gallery (**Settings › Editor & Appearance › More themes › Browse themes**). `settings.userThemes` lists them; a gallery theme's entry also has `gallery: {id, updated, source}`, the version installed, which is how an update is noticed.                                        |
| `textus/agent.md`, `textus/skills/`                                                                 | The global config folder: global writing instructions and skills ([AI-CONCEPTS.md](../design/ai-concepts.md)), including copies of built-in skills made with Customize… (marked `textus-based-on`). Built-ins turned off are listed in `settings.disabledBuiltinSkills`.                                                               |
| `textus/memory/<slug>.md`                                                                           | What Textus AI remembered about the user for every project, one memory per file (`ai::memory`); the project's own are in its `.textus/memory/`. Off with `settings.rememberAutomatically`.                                                                                                                                             |
| `provider_keys.json`, `api_key.json`, `custom_endpoint.json`, `auth-codex.json`, `auth-claude.json` | AI credentials, and in `provider_keys.json` also the image hosts' tokens under ids starting `__image_host` (`credential_id` in `src-tauri/src/commands/image_host.rs`); owner-only on Unix.                                                                                                                                            |

`settings.json`'s `writingConventions` is also read by Rust
(`ai::conventions`), which owns its meaning: `"automatic"` (the default; a
missing field means the same), one profile such as `"en-GB/govuk"` (what
Settings > Textus AI > Writing conventions stores; it applies to documents in
that profile's language, the others stay Automatic), or `{ "zh-Hans": "zh-Hans-CN/tech", "en":
"en-GB/govuk", "options": { "cjk-latin-space": "on" } }` - one profile per
language key, `"automatic"` or a missing language meaning Automatic. The
allowed values are `writing_conventions_options` (`platform/ipc.ts`:
`WRITING_CONVENTIONS`).

`settings.json`'s `runInBackground` is **Settings › General › Application
› Keep running in the background**, off by default, and Rust reads it
(`src-tauri/src/background/`). [lifecycle.md](lifecycle.md) has the rest.

1.2.0-rc.1 had Quick Notes and a login entry, both taken out before 1.2.0:
the `quickNote*` and `openAtLogin` fields an rc.1 settings file may still
have are read by nothing, and neither is the data directory's `quick-note/`
folder.

`settings.json`'s `updateChannel` is **Settings › General › About Textus ›
Update channel**: `"stable"` (the default; a missing or unknown value means
the same) or `"beta"`. Rust doesn't read the file for it: the frontend sends
the channel with each update check (`check_for_update` in
`src-tauri/src/commands/update.rs`).

### Data directory

| File                       | What                                                                                                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui-state.json` †          | Where the UI was left: `{"schemaVersion": 1, "state": {...}}` with the fields of `UiState` in `src/storage/ui-state.ts`.                                                                                                                                                |
| `chat-history/`            | Saved Agent conversations, one file each - see [Chat history](#chat-history) below.                                                                                                                                                                                     |
| `clipboard-history.json` † | The clipboard panel, newest first, at most 30 entries of up to 50,000 characters.                                                                                                                                                                                       |
| `drafts/`                  | Crash recovery for unsaved documents.                                                                                                                                                                                                                                   |
| `assets/`                  | Images pasted into a document that has not been saved yet, referenced by absolute path until its first save moves them into the folder chosen by the `imageFolder` setting: a subfolder of the document's folder (`assets` by default), or `./` for that folder itself. |

On iOS a document path inside the app's Documents folder is stored as
`documents:<path inside Documents>` - a conversation's `docPath`, like the
recent documents in `ui-state.json` - because the app's container, and
every absolute path into it, moves with each reinstall and update
(`src/platform/documents-path.ts`). An absolute container path stored by an
earlier version is rewritten that way when the history loads.

### Chat history

`src-tauri/src/settings/chat_history.rs`. Up to 1.0 the conversations were
one `chat-history.json`, rewritten whole on every saved turn and capped at
60 by dropping the oldest. Since 1.1.0 they are a folder:

| File                            | What                                                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat-history/<id>.json`        | One conversation: `{"schemaVersion": 1, "entry": {id, docPath, title, updatedAt, turns}}`. Attached images are kept as their name and type only.                                        |
| `chat-history/index.json`       | What the AI panel's history shows, most recent first: `{"schemaVersion": 1, "entries": [{id, docPath, title, updatedAt, turnCount}]}` (`ChatSummary` in `src/ai/chat/chat-history.ts`). |
| `chat-history/.trash/<id>.json` | Conversations moved out of the list by the cap, as they were.                                                                                                                           |

- Saving a turn rewrites only that conversation's file and the index, each
  debounced and written like every other file here. The windows hold only
  the index; a conversation's turns are read (`chat_history_get`) when it
  is reopened.
- The index keeps the newest 500 conversations. A save that pushes one past
  that moves the oldest's file into `.trash/`, and the history list says that
  older conversations were archived. `.trash/` keeps at most 200 files; past
  that the oldest (by modification time, which a move keeps) are deleted.
- A conversation id is a file name, so only ids of letters, digits, `-` and
  `_` are accepted. Only files named that way are ever moved or deleted;
  anything else put in the folder is left alone.
- **Privacy › Clear chat history** deletes every conversation file in the
  folder and in `.trash/`, and empties the index. Deleting one conversation
  in the history list deletes its file (not into the trash).
- A document saved under a new path by Textus (Save As, a rename in the
  iPhone's document list) takes its conversations along
  (`chat_history_move_document`).
- An index that is missing or corrupt while conversation files are there is
  built again from the files.

**Migration from `chat-history.json`.** On the first launch that finds no
`chat-history/` folder but an old `chat-history.json` (`chat-history.dev.json`
in a debug build), Rust splits it: every conversation's file and the index
are written into `chat-history.migrating/`, which is then renamed to
`chat-history/` in one step, and only then is the old file renamed to
`chat-history.json.migrated` - never deleted. A crash before the folder's
rename leaves no folder, and the next launch starts over; once the folder
exists, the old file is never read again. An old file that can't be parsed
is moved aside as `chat-history.json.corrupt-<unix time>` and the history
starts empty, like any other file here; one that can't be read is left
alone and nothing is saved for that session. Conversations brought by the
move out of localStorage or the Levis import are added to the folder the
same way.

The webview's own storage also lives here (`localstorage/`, `WebKitCache/`
and so on; `EBWebView\` under `%LOCALAPPDATA%` on Windows). Since 0.9.7 the
only key the app still uses there is `textus-fetched-models:<provider>`, a
cache of each provider's model list that is simply fetched again when
missing.

## How the files are written

- Rust holds each file in memory and is its only writer. Windows change
  settings and UI state one top-level field at a time (`settings_patch`,
  `ui_state_patch`), and the histories one entry at a time
  (`history_upsert`, `history_remove`, `history_clear`; a conversation is
  its own file) - never by writing a
  whole object or list back, so two windows changing different things both
  land. Every settings and history change is broadcast to all windows.
- Writes are debounced by 250 ms and flushed when the app exits, through a
  write-then-rename, so a crash never leaves a half-written file. That
  debounce is the only one for settings: windows send every change as it is
  made, keystrokes in Custom CSS included, so quitting right after typing
  loses nothing. (The zoom alone is held back until a pinch or wheel burst
  has rested for 400 ms.)
- A window never closes with a change still on its way to Rust. IPC is
  asynchronous, so every close path the app owns - the window's close
  request (close button, Close Window, Quit and Cmd+Q, Alt+F4), the
  unsaved-changes prompt, closing the last tab, the detached chat, an
  update's install - first sends what's held back (the resting zoom) and
  waits for Rust to answer every settings, UI-state and history write
  (`src/storage/pending-writes.ts`, at most 2 s). On iOS, going to the
  background sends what's held back too.
- A file that can't be parsed (or isn't UTF-8) is renamed to
  `<name>.corrupt-<unix time>` and the app starts from defaults rather than
  refusing to start. A window that boots with no settings at all writes the
  defaults out with `settings_fill_defaults`, which only adds fields that
  are missing: a reload replays that same empty snapshot, and must not put
  the defaults back over what was changed since.
- A file that is there but can't be read for another reason (permissions,
  an I/O error) is left exactly as it is: the app logs it, runs on defaults
  held in memory for that session, and writes nothing over it.
- `schemaVersion` changes only for a change an older reader would misread.
  Adding a field never needs it: readers fill in defaults for missing fields.
- Before a window loads, Rust injects the current settings and UI state as
  `window.__BOOT__` and applies the theme, so the first frame is already
  right (`src-tauri/src/boot.js`, `src/storage/boot.ts`). For an imported
  theme that includes the app's chrome colours derived from it: working
  them out takes a CSS engine (`applyThemeChrome` in
  `src/theme/theme-chrome.ts`), so the frontend remembers the result in
  `ui-state.json` (`themeChrome`, per theme and appearance) and the boot
  script applies it when it matches.
- Until its page first paints, a window shows the platform's own
  background, so Rust also follows a pinned Light or Dark natively
  (`theme_changed` in `settings.rs`): on macOS it sets the app's appearance
  (`apply_app_theme`), on Linux it builds windows in the page's background
  colour and recolours open ones (`pinned_background`).

## The move out of localStorage (0.9.6 to 0.9.7)

On the first launch without `settings.json`, every window boots with
`legacyImport`. The first window to load reads its localStorage -
`catvinci-settings`, `levis-chat-history`, `levis-clipboard-history`,
`levis-tutorial-progress`, `levis-agent-panel-open`,
`levis-agent-panel-width`, and on iOS `levis-ios-recent-documents` and
`levis.documentListView` - and hands it to Rust
(`settings_import_legacy`), which keeps the first such offer only. Until it
arrives, `prefs.json`'s two old keys stand in for the settings Rust needs
at startup. The localStorage keys are left untouched, so a downgrade to
0.9.6 still finds everything as it was. Textus keeps these keys' `levis-`
names: they are what a Levis 0.9.6 webview holds, and still what the
fallback (no Rust boot snapshot, as in the browser) reads and writes.

## Importing Levis data into Textus

Textus has a new identifier (`com.catvinci.textus`, Levis was
`com.chengaoshen.levis`), so its directories start new and empty. On its
first launch, if its own `settings.json` doesn't exist, it can import a
Levis installation by copying from Levis's directories (the table above with
`com.chengaoshen.levis` in place of `com.catvinci.textus`):

1. `settings.json`, `ui-state.json`, `chat-history.json`,
   `clipboard-history.json` - read with the same code, since the format is
   the same; the conversations are written into Textus's `chat-history/`
   folder. A `schemaVersion` newer than Textus knows means a newer Levis
   wrote it; read it best-effort (unknown fields are kept) rather than
   discard it.
2. `themes/`, `agent/`, `recent_files.json`, `session.json`, `prefs.json`
   as they are.
3. Credentials only with the user's consent, keeping them owner-only.
4. Not `drafts/` and `assets/` by default: drafts are crash leftovers, and
   documents refer to `assets/` by absolute path into the Levis directory,
   which stays where it is.

The Levis directories are left in place, so Levis keeps working alongside.
A Levis older than 0.9.7 has no files to copy; Textus doesn't read another
app's webview storage, so such a user updates Levis once first.

## Project folders: `.textus/`

A project's own settings live in its `.textus/` folder
([AI-CONCEPTS.md](../design/ai-concepts.md)):

| Path                            | What                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `agent.md`                      | The project's writing instructions.                                                                           |
| `style.md`, `style.previous.md` | The style profile, and the one "Learn my style" replaced.                                                     |
| `library/<name>.md`             | The library, one entry per file; an entry Textus AI wrote has `remembered-by: textus-ai` in its front matter. |
| `memory/<slug>.md`              | What Textus AI remembered about the project, one memory per file (`ai::memory`).                              |
| `skills/<name>.md`              | The project's skills.                                                                                         |

The project folder is the nearest folder holding the document that has a
`.textus/` (up to, never including, the home folder or a drive root), else
the document's own folder, unless one was chosen.

A project made with Levis has a `.levis/` folder instead, which Textus does
not read. While `.levis/` holds files `.textus/` lacks, the project bar
offers once to convert it: Convert copies those regular files into
`.textus/` through the atomic writer (symlinks skipped, nothing in
`.textus/` overwritten, `.levis/` untouched, so a Levis install sharing the
folder keeps working) - `ai::levis_project`; Not now adds the project
folder to `ui-state.json`'s `levisProjectsDeclined` instead, and the Memory
tab keeps **Convert Levis data**.
