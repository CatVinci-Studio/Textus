# Documents and tabs

How a document lives in a window: the tab that holds it, how it opens,
when it is saved, what protects unsaved writing, and how it closes. What a
save writes into the Markdown file is
[markdown-roundtrip.md](markdown-roundtrip.md); where the app's own files
are is [storage.md](storage.md).

## The tab

Every tab is a `DocTab` (`src/document/doc-tabs.ts`), held by
`src/app/tabs/useTabState.ts`:

| Field                                   | Means                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `path`                                  | The file, or `null` for an untitled draft.                                                                  |
| `content`, `savedContent`               | What the editor holds, and what is on disk. A tab is dirty while they differ (`tabIsDirty`).                |
| `diskMtime`                             | The file's modification time at the last read or write; a different one on disk is an outside change.       |
| `sourceMode`, `splitView`               | **View › Mode**: rich, source, or source with a preview beside it (`src/editor/modes/view-mode.ts`).        |
| `reloadKey`                             | Raised to remount the editor on new text (a reload, a file replacing a draft).                              |
| `preview`                               | Opened by a single click, to look. Its title is in italics; it is kept once written in or double-clicked.   |
| `readOnly`                              | **View › Mode › Read Only**, remembered by path (`document/read-only.ts`).                                  |
| `view`                                  | A plugin's view or file editor (a PDF, a board) shown instead of a document; the plugin saves its own file. |
| `helpDoc`, `importedFrom`, `draftTitle` | A bundled guide; the Word file a new document was made from (never written); a draft's own name.            |
| `start`                                 | The start page, shown until something opens in the tab.                                                     |

A tab with no path, no guide, no view and no text is an untouched draft
(`tabIsUntouchedDraft`): opening something there loses nothing, so it
gives way.

## Opening

Every way a file becomes a tab goes through `src/app/useFileOpening.ts`.
`openFile(path, options)` holds the one rule of the window:

1. **Already open**: the tab that has it comes to the front. A preview tab
   opened on purpose (not another look) becomes a kept tab.
2. **A look** (`preview: true`, a single click in the file tree or a
   plugin's list): it takes the preview tab, if one is open with nothing
   written in it.
3. **An untouched draft in front** gives way: the file replaces it, unless
   `where` or a drop says otherwise.
4. **Anything else** gets a tab of its own (`openPathInTab`). Nothing
   written is ever replaced.

`where` places a new tab: `"tab"` (the default) after the others,
`"beside"` in a split next to the tab in front, `"current"` in place of the
tab in front (plugins' tabs only, `src/plugins/usePluginWindow.ts`). A drop
on the documents (`drop`) opens on that side of a split.

Before a file is read as a document, `readDocument` asks whether it is
something else: a file type a plugin opens, or a Markdown file a plugin
claims by its front matter, opens in that plugin's tab; a Word document
becomes a new, unsaved document (`document/word-import.ts`); a file that
isn't text offers a market plugin that opens it, or the system's app.
`asDocument` skips all of this. Reopening (Open Recent, the last session)
goes back to the last caret, kept by path and modification time
(`document/last-carets.ts`); a followed link's `#heading` or a plugin's
place is gone to once the tab shows (`editor/tab-jump.ts`).

Other ways in: **File › Open** and Open Recent (`openFileDialog`,
`openRecentFile`), files dropped on the window (`useFileDrop`: the first
may take an untouched draft's place, the rest get tabs, images go into the
document, a folder opens in the sidebar), files the OS opens in a running
app (`useOpenPathsPush`, the `open-paths-as-tabs` event), and followed
links and project-bar entries, which always get a tab of their own.

### At launch

`src/document/startup-restore.ts` decides what fills a new window's blank
tab, once, in this order: the tabs the page had before a reload (kept in
sessionStorage by `document/reload-tabs.ts`), a tab dragged out of another
window, recovered drafts (as extra tabs), a guide the window was opened
for, files given on the command line or by the OS, this window's documents
from the last session (`session.json`, when **Settings › General › On
launch, open** is **Last documents**), and on iOS the last document.

## Saving

`src/app/useSaveTabs.ts` does Save and Save As; both resolve `true` only
when the document reached disk.

- **Save** on a tab with a path writes it; on an untitled one it is Save
  As. Saves of one tab run one at a time, so a second never mistakes the
  first's write for an outside change.
- **Before writing**, the file's modification time is read again. If it
  changed or the file is gone, the user is asked whether to overwrite (or
  recreate) it; a no leaves the tab dirty.
- **Plugins' `onWillSave`** may change the text first; the change goes
  into the editor as one undo step, so what is saved is what shows. After
  the write, plugins hear `didSave`.
- **The write** keeps the file's line endings and byte-order mark
  (`writeDocFile`, `document/file-format.ts`) and goes through Rust's
  write-then-rename. A tracked document's file gets its original, the
  changes going beside it (`document/tracked-file.ts`). A failed write says
  why, and the tab stays dirty.
- **A first save** (Save As, or an untitled draft's autosave) moves
  pictures pasted into the draft from the app's `assets/` folder into the
  document's picture folder, and takes the draft's conversations along to
  the new path.
- **Save As** suggests the first heading or line as the name
  (`document/save-default-name.ts`, or the AI's title for the draft), in
  the document's folder, else the open folder, else the last one used. It
  refuses to write Markdown into a `.docx`.

### Save Automatically

**Settings › General › Save automatically** (`autosave`, off by default;
`src/document/autosave.ts`). With
it on, a dirty tab is written 2 seconds after typing rests, and at once on
blur, when the window hides and on a tab switch. An untitled draft gets a
file of its own in the folder open in the window, named after its title
(`document/autosave-untitled.ts`, numbered rather than overwriting); it
waits 30 seconds while only its first line is written, and its file
follows the title until the user names it. With no folder open, an
untitled draft is left to draft recovery. A save the user cancels at the
outside-change prompt, or one that fails, pauses autosave for that tab
until it is saved, reloaded or saved elsewhere, so the prompt shows once.

## Drafts: unsaved writing survives a crash

With **Settings › Privacy › Recover unsaved content after a crash** on
(`enableDraftRecovery`, the default),
every dirty tab is snapshotted a few seconds after typing settles, or every
30 seconds during a long burst (`src/document/draft-autosave.ts`). Rust
keeps one snapshot per tab in the app's `drafts/` folder
(`src-tauri/src/commands/drafts.rs`) and deletes it once the tab is saved
or closed. What is still there at the next launch is unresolved: it opens
as recovered tabs, unless the file on disk already holds the same text.

**Keep unsaved changes when closing, without asking**
(`keepUnsavedOnClose`, off by default, needs draft recovery) closes a window
with unsaved tabs without asking, keeping them as drafts for the next
launch.

## Changes made outside Textus

`src/document/useExternalChangeReload.ts` compares each tab's `diskMtime`
with the file: when the window gains focus, when something in the window
wrote a file, and every 1.5 seconds for the documents on screen while the
window shows.

- A clean tab whose file changed reloads (its `reloadKey` moves); a file
  touched but not changed (iCloud re-stamps files) only updates the time.
- A dirty tab is left alone: the next save asks before overwriting.
- A deleted file leaves the tab as it is; saving asks before recreating it.

When the app itself renames, moves or deletes a file (the file tree, the
iPhone's document list), the open tabs follow (`app/useDocumentActions.ts`),
and links to a moved note are rewritten (`files/move-links.ts`).

## Closing

- **A tab** (`useTabRemoval` in `src/app/close-flow.ts`): autosave is
  flushed first; a clean tab closes, a dirty one gets the prompt
  (**Save**, **Don't Save**, **Cancel**; `ClosePrompt.tsx`). Closing the
  last tab closes the window, or shows the start page when that setting is
  on; on iOS the last tab stays. **File › Reopen Closed Tab** brings back
  the latest closed document.
- **A window** (`useWindowCloseGuard`): every close path - the close
  button, Close Window, Quit - flushes autosave, then prompts once for all
  dirty tabs, or keeps them as drafts with `keepUnsavedOnClose`. Pending
  settings and UI-state writes reach Rust before the window goes
  ([storage.md](storage.md#how-the-files-are-written)). Quitting asks every
  window in turn ([lifecycle.md](lifecycle.md#quitting)).
- Changes still to decide (Textus AI's proposals, the writer's tracked
  changes) are kept with the document when it closes, and come back when
  it opens again (`document/undecided.ts`).

## Tabs out of sight

A document's editor out of sight for 10 minutes is let go, and opens
again at its text with its undo history when shown (`EditorKept` in
`src/app/islands/DocumentIslands.tsx`, `utils/kept-loaded.ts`; the undo history is kept
in the app's `undo/` folder by `editor/undo-file.ts`). An editor holding
Quick Ask, a proposal of Textus AI's or undecided changes stays
loaded (`document/editor-held.ts`), and so does one with no file to come
back from. Plugin views and web pages out of sight
are let go after 5 minutes.
