# Architecture

Where things live and which way the dependencies point. Read this before
adding a folder or an import that crosses one. Other documents go deeper:
[documents.md](documents.md) (a document from opening to closing),
[storage.md](storage.md) (what is saved where), [testing.md](testing.md)
(what each suite covers), [recipes.md](recipes.md) (adding a setting, a
menu item, a command), [ai-proposals.md](../design/ai-proposals.md) (an AI
edit from stream to document) and [plugin-api.md](plugin-api.md) (the
registries plugins add to).

Textus is a Tauri 2 app. The frontend in `src/` is React and TypeScript;
the document is edited in Milkdown (ProseMirror), and source mode in
CodeMirror 6 (`src/editor/modes/SourceEditor.tsx`, `DocSourceEditor.tsx`).
The backend in `src-tauri/` is Rust; the code that talks to AI providers is
the crate `src-tauri/crates/aicompat/`, which has no Tauri in it.

## Layers

`src/` is grouped by feature, and the features are stacked in layers.
ESLint enforces the import direction (`no-restricted-imports` in
`eslint.config.js`, run by `npm run lint`); a type-only import may cross,
since it leaves nothing behind at runtime, and tests (`*.test.*`) are not
held to it.

```
shell     app/  document-view/  lazy/  playground/  help/       may import anything
features  ai/  clipboard/  document/  editor/  export/  files/
          mobile/  onboarding/  plugins/  settings/  theme/     each other, registry/, engine/ and base; never the shell
registry  registry/                                             engine/ and base
engine    engine/ (tokens, motion, frame, drag, controls, layout)   base only
base      platform/  utils/  i18n/  storage/  prefs/            each other; nothing above
-         the entry files src/*.ts(x), dev/                      not layered (below)
```

What the lint enforces:

- **Base** (`platform/`, `utils/`, `i18n/`, `storage/`, `prefs/`) imports
  no `engine/`, `registry/`, feature or shell folder. The five are one
  layer to the lint.
- **`engine/`** imports no feature, registry or shell folder; inside it
  each part uses only those before it - `tokens/`, `motion/`, `frame/`
  (the solver and the clock), `drag/`, `controls/`, `layout/` - and
  `controls/` never the layout.
- **`registry/`** holds what the shell and the features both register into
  or read: commands (`commands.ts`), the menu model (`menu/`), the fixed
  shortcuts, the sidebar tabs and context-menu items plugins add, the file
  marks a feature puts on the tree's rows. It imports only the engine and
  base, so `plugins/` and the features reach these without the shell.
- **Features** import no shell folder (`app/`, `document-view/`). They may
  import each other, with one exception: **`editor/`** never imports
  `ai/`, `document/`, `export/`, `files/`, `mobile/`, `onboarding/` or
  `plugins/`. The Markdown editor works on its own - its block model
  (`editor/markdown/doc-blocks.ts`, `doc-markdown.ts`, `edit-actions.ts`)
  included, which the AI and plugins build on; plugins attach through
  `editor/extension-points.ts`.
- **`plugins/`** is a feature like the others: what the window lends it
  comes through `plugins/app-bridge.ts` and `configurePlugins` (its
  window info: strings, keys, the command palette), set by
  `app/usePluginWindow.ts`.
- **The shell** (`app/`, `document-view/`, `lazy/`, `playground/`,
  `help/`) may import anything except the plugin system's insides.
- **Nothing outside `plugins/` imports `plugins/host/`**: the sandbox, the
  runtimes and the broker can change without the app noticing.
- **Only `src/platform/` and `src/dev/` import `@tauri-apps/*`**, so the
  same code runs in the browser build, where each platform module has a
  stand-in (`TEXTUS_BROWSER`, `platform/runtime.ts`).

What is only convention:

- **`lazy/` and `help/`** are linted as shell but are used from every
  layer: `lazy/lazy-module.ts` is how anything loads on first use, and
  `help/` is only the bundled guides.
- **Nothing imports `playground/`**; it is its own entry.
- The entry files: `main.tsx` picks the window to render (an editor
  window, the detached chat, a floating plugin view, the background host);
  `plugin-api.ts` is the in-process registry API (`window.__textusPlugins`
  in a development build); `test-setup.ts` is vitest's.

**The window's model has one owner**: `engine/layout/store.ts` holds the
tabs, the tab in use and the islands, and settles the layout with every
change. React reads it (`app/tabs/useTabState.ts`), the frame store keeps
only geometry, and code that needs the tab in use asks it
(`tabInUse()`, `engine/layout/tab-element.ts`), never the DOM.

The other checks `npm run check` runs (cycles, copies, dead code, code
shape) are listed in [code-style.md](code-style.md).

## UI layering

Inside the interface, a second, finer order: **tokens → styles →
components → patterns → features**. A layer never re-defines a value an
earlier one defines, and never imports from a later one. The design rules
for each are in [design-language.md](../design/design-language.md).

| Layer      | Today                                                                                              | Holds                                   |
| ---------- | -------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Tokens     | `src/engine/tokens/base.css`, `design-system.css` (variables), `motion.css`                        | Role tokens and their derivation        |
| Styles     | `src/engine/tokens/design-system.css` (controls, states), `src/plugins/host/runtime/plugin-ui.css` | Control looks and states, once          |
| Components | `src/engine/controls/*.tsx` (`Select`, `Tooltip`, `ContextMenu`, `app-dialog`, `InfoTip`, `icons`) | React wrappers; no own colours or sizes |
| Patterns   | Settings rows, the sidebar, menus, the command palette                                             | Arrangements of components              |
| Features   | `src/editor`, `src/ai`, `src/files`, `src/settings`, `src/plugins`…                                | Compose the layers above                |

Held by tests: `src/engine/controls/theme-reach.test.ts`,
`engine/motion/motion-tokens.test.ts`, `motion-properties.test.ts`,
`style-invalidation.test.ts`, `e2e/a11y.spec.ts`, and the contrast tests in
`src/engine/tokens/palette.test.ts`.

Planned, not built: a layout that gives each layer a folder of its own
(`src/engine/tokens/`, `styles/`, `icons/`, `components/`, `patterns/`, with
`plugins/host/` injecting tokens, styles and icons into plugin pages),
moved file by file as files are touched; a Stylelint configuration banning
literal colours, px font sizes, off-grid spacing, raw radii and raw
durations, offered to plugin authors too; a test that every public token
resolves in every built-in theme; and a component gallery page in dev mode
that is also the visual regression target.

## The frontend's folders

| Folder           | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/`           | The editor window. `App.tsx` composes it from the window hooks (`useWindowShell`, `useWindowDocuments`, `useWindowWiring`, `useFileOpening`, `useSaveTabs`, `close-flow.ts`, `ClosePrompt.tsx`), `WindowBar`, `StartPage`, the command palette, global shortcuts, zoom, F6 regions (`regions.ts`), plugins' status items.                                                                                                                                                                                                |
| `app/tabs/`      | The tabs' state (`useTabState`), tabs that show a page - Settings, a plugin's page, Create, an AI conversation (`page-tabs.tsx`) - and tab drag between windows (`useTabDragMerge`).                                                                                                                                                                                                                                                                                                                                     |
| `app/frame/`     | The window's frame: the window bar (`WindowBar`), the activity rail, the sidebar with Textus's own tabs (`sidebar-tabs.tsx`, the iPhone's `SidebarTabBar.tsx`) and the panels' state.                                                                                                                                                                                                                                                                                                                                    |
| `app/islands/`   | What this window's islands show (the layout itself is `engine/layout/`): the documents' islands, Textus AI's conversations as tabs (`useAiTabs`), a tab pulled out of its row (`tab-pull.ts`), the split saved and restored.                                                                                                                                                                                                                                                                                             |
| `app/menu/`      | The menu drawn (`AppMenu.tsx` and `MenuBar.tsx` on Windows, Linux and iPad, and on the phone) from the model in `registry/menu/`, native menu events (`menu-bridge.ts`), the macOS bar's labels (`native-menu-text.ts`), Open Recent (`recents.ts`).                                                                                                                                                                                                                                                                     |
| `app/report/`    | The error boundary and **Help › Report a Problem**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `document-view/` | One tab's document on screen. `MilkdownEditor.tsx` is the editor with everything attached (AI panel, Quick Ask, review margin, grammar card, tutorial hooks), split into `use*.ts` hooks beside it. `editor-extensions.ts` puts the editor core and the AI plugins together. `EditorPane` switches between the rich editor, source and split view. `plugins/` is what plugins do in the editor. The editor test harnesses live here too.                                                                                 |
| `document/`      | A document's life outside the editor ([documents.md](documents.md)): the tab model (`doc-tabs.ts`), autosave, draft recovery, reload after an outside change, the session and reload restore, read-only, line endings (`file-format.ts`), Word import, last carets, the iPhone's recent documents.                                                                                                                                                                                                                       |
| `editor/`        | The Markdown editor. Core plugins register in `editor-extensions.ts`, in load order. Subfolders by feature: `markdown/` (parse, save, paste, front matter, render to HTML), `marks/`, `math/`, `code/`, `tables/`, `images/`, `html/`, `find/`, `embeds/`, `chart/`, `emoji/`, `hover/`, `completion/`, `clipboard/`, `lazy-blocks/`, `keys/` (key handling per platform), `modes/` (source in CodeMirror, split, typewriter, zen; `view-mode.ts` is **View › Mode**). `extension-points.ts` is where plugins add to it. |
| `ai/`            | Textus AI. `editor-plugins.ts` registers its plugins on the editor. `chat/` is the conversation the three chat surfaces share, with `quick-ask/`, `panel/` and `window/`; `revision/` turns a proposed edit into decided sentences; `margin/` draws revisions and notes beside the text; `writing/` is completion and the grammar check; `paper/` the long-form paper writer ([ai-paper.md](../design/ai-paper.md)); `skills/` the built-in skills and their translations; `citations.ts` sources as footnotes.          |
| `export/`        | **File › Export**: PDF and HTML from the rendered page, everything else through pandoc.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `theme/`         | How documents look and how themes are read: the built-in themes, the document CSS (`content-base.css`), importing a Typora theme, the theme gallery, window colours from a theme (`engine/tokens/palette.ts`), putting the appearance settings on the page.                                                                                                                                                                                                                                                              |
| `settings/`      | The Settings window: `pages/` (General, Editor, AI, Extensions with the plugin pages, Create), `sections/` (the rows; `controls.tsx` holds `SettingRow` and `ToggleRow`), search over the pages (`settings-search.ts`).                                                                                                                                                                                                                                                                                                  |
| `files/`         | The folder and its notes: the file tree, file search, the outline panel, moving files with their links, and the links between notes - one resolver for every way a link is followed (`link-resolve.ts`, its cases shared with Rust `resolve_note_link`), writing a link the way the folder does.                                                                                                                                                                                                                         |
| `clipboard/`     | What a copy tells plugins (`copied.ts`, `copied-plugin.ts`) and Copy Path. The clipboard history itself is the official Clipboard History plugin.                                                                                                                                                                                                                                                                                                                                                                        |
| `mobile/`        | Phone-only screens: the document list, the keyboard toolbar, page swipes; `styles/` holds the phone layout's CSS ([ios-code-map.md](ios-code-map.md)).                                                                                                                                                                                                                                                                                                                                                                   |
| `onboarding/`    | The first-run language picker and the tutorial.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `plugins/`       | The plugin system ([below](#the-plugin-system)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `engine/`        | What every surface is drawn and moved with, knowing no document, AI or plugin, each part using only those before it: `tokens/` (sizes, the interface scale, the one palette a theme's base colours derive into, `palette.ts`), `motion/` (timing, FLIP, presence), `drag/` (a drag, a row making room, the floating copy), `controls/` (dialogs, `Select`, `ContextMenu`, `Tooltip`, `InfoTip`, `PanelHeader`, `ResizeHandle`, `Sheet`, `CornerToast`, notices, the quick pick, icons), `layout/` (the island control).  |
| `prefs/`         | The settings model: the `Settings` type and defaults (`settings-types.ts`), reading a stored file back (`settings-normalise.ts`), the store and its sync between windows, `SettingsProvider` / `useSettings` (`SettingsContext.tsx`), the rebindable shortcuts (`shortcut-defaults.ts`).                                                                                                                                                                                                                                 |
| `storage/`       | Persisted state through the backend: the boot snapshot, pending writes, UI state, persisted lists, a project's `.textus/settings.json` (`project-settings.ts`), the webview's own localStorage (`local.ts`).                                                                                                                                                                                                                                                                                                             |
| `platform/`      | The backend bridge ([below](#talking-to-the-backend)), OS and capability facts (`os.ts`, `capabilities.ts`), window chrome, events, iOS file access, menu events on iOS.                                                                                                                                                                                                                                                                                                                                                 |
| `i18n/`          | The UI strings (`locales/`), language names, plural rules. See [translating.md](translating.md).                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `utils/`         | Pure helpers (paths, CJK, word count, shortcuts, events, front matter) and small React hooks (`hooks/`).                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `lazy/`          | Loading on first use: `lazyModule`, `lazyComponent`, and warming what is likely soon.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `help/`          | The bundled Markdown and AI guides, one file per language.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `playground/`    | The browser playground: the editor alone in a web page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `dev/`           | The browser shim that stands in for Tauri under `npm run dev` and in the e2e flows (`tauri-shim.ts`, with `plugin-shim-api.ts` for the plugin commands).                                                                                                                                                                                                                                                                                                                                                                 |

Tests sit next to the file they test (`x.ts` and `x.test.ts`). End-to-end
flows are in `e2e/`.

## The plugin system

`src/plugins/` runs plugins in sandboxed frames and registers what they
add into the app's own registries (`app/commands.ts`,
`app/frame/sidebar-tabs.tsx`, `engine/layout/store.ts`, the editor's extension
points). Its folders, by job:

| `plugins/`       | Holds                                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host/`          | Running a plugin: the sandboxed frames, the runtimes put in them (`runtime/host.js`, `text.js`, `webview.js`), the broker that answers every call (`broker*.ts`), the RPC. |
| `contributions/` | The registries of what plugins add: commands and menus, code blocks, decorations, completions, hover cards, links, lists, AI tools, before-save.                           |
| `views/`         | What draws plugins: webviews, lists, web pages, forms, floating views, the theme given to a page.                                                                          |
| `store/`         | What is installed and how: manifests, the catalog, records and their state, permissions, settings, logs, export, migration, offers.                                        |
| `workspace/`     | What plugins know of the folder: the metadata index, globs.                                                                                                                |
| `background/`    | Scheduled jobs and the hidden background host window that runs them when no editor window is open (desktop).                                                               |

At its top: `manager.ts` (records, install, on and off; the loader),
`app-bridge.ts` (what the window lends plugins, and `emitPluginEvent` for
what they hear), `api-permissions.ts` (the one table of which call needs
which permission, read by the broker and the install check),
`panels-state.ts` and `ai-state.ts` (what plugins hear of the window's
panels and of Textus AI), `chat-plugin.ts`, `plugin-uri.ts` and
`usePluginWindow.ts` (the window's side of the bridge).

The public API is `docs/dev/textus.d.ts`; [plugins/](plugins/README.md) is
the plugin author's guide, and [recipes.md](recipes.md#add-a-plugin-api-call)
says how a call is added.

## Talking to the backend

The frontend reaches Rust only through `src/platform/`:

- **`ipc.ts`** exports one object per area (`fs`, `drafts`, `session`,
  `ai`, `exportDoc`, …); the areas are split over `ipc-app.ts`,
  `ipc-files.ts`, `ipc-plugins.ts`, `ipc-auth.ts`, `ipc-schedule.ts` and
  `ipc-ai-types.ts`, and `ipc.ts` re-exports them.
- **`ipc-call.ts`** is how every command is called: `command(name, …args)`
  for a command with generated types, `call(name, args)` for one without;
  `aiCommand` / `aiCall` refuse while Textus AI is off; `desktopQueryCommand`
  answers a fallback and `desktopActionCommand` / `desktopAction` reject on
  iOS, where desktop-only commands aren't registered.
- **`bindings/*.ts`** are generated from the Rust commands by tauri-specta
  (`src-tauri/src/bindings.rs` lists which command goes into which file).
  Never edit them: `npm run bindings` writes them again, and `cargo test`
  fails while they are out of date. A command whose arguments specta can't
  describe (struct inputs, raw bytes, iOS-only) is called with `call`.
- **`events.ts`** listens to events Tauri sends this window or webview, and
  sends events to other windows.

[recipes.md](recipes.md#add-a-backend-command) walks through a new command
end to end.

## CSS

- Component CSS lives next to its component and is imported by it. It
  reads tokens only - colours (`--ui-*`, `--doc-*`), shapes (`--shape-*`),
  text roles (`--text-*`), control heights, spacing and motion - by the
  rules in [design-language.md](../design/design-language.md); a raw
  colour, radius or font size is a review comment.
- The main window's own layout is `app/App.css`, a list of `@import`s in
  cascade order: the base tokens, then the window bar, sidebar, tabs, text
  column, notices, dialogs, sidebar panels, print rules and modes. Later
  files win ties, so keep print rules after what they hide and the modes
  last. Each piece lives in the folder of the feature it styles.
- The document's look is `theme/content-base.css` (a cascade layer, so an
  imported Typora theme or the user's Custom CSS wins over it) and
  `editor/milkdown-theme.css` (what makes the editor work: carets, markers,
  previews - not in the layer, so a theme can't break them).
- An imported theme is CSS text: `theme-import.ts` inlines its `@import`s
  and assets, `typora-compat.ts` adapts Typora selectors,
  `legacy-variables.ts` reads pre-1.3 variable names under today's, and
  `engine/tokens/palette.ts` reads its colours to tint the window around it.

## Backend (`src-tauri/`)

| Path                                                     | Holds                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.rs`, `src/lib.rs`                              | The entry (`main` asks the CLI first) and app setup: plugins, state, the one `invoke_handler` list (shared commands, then `#[cfg(desktop)]` ones), `desktop_builder` and `desktop_setup`.                                                                                                                  |
| `src/commands/`                                          | Commands the frontend calls, one file per area: files and folders (`fs`, `folder`, `tree_ops`, `documents`), drafts, undo files, session, recents, export, the chat window, attachments, themes, the theme gallery, links, update, …                                                                       |
| `src/bindings.rs`                                        | Which command goes into which generated `src/platform/bindings/*.ts` file, and the test that keeps them current.                                                                                                                                                                                           |
| `src/settings/`, `settings.rs`, `boot.js`                | The settings, UI state and history files, the chat history folder, the boot script every webview gets ([storage.md](storage.md)).                                                                                                                                                                          |
| `src/editor_windows.rs`, `window_frame.rs`               | Editor windows: built with each platform's chrome, numbered, opened and reopened (`build_main_window`, `open_new_window`, `reopen_without_windows`), and where a window opens.                                                                                                                             |
| `src/launch.rs`                                          | Files the app is asked to open, held until a window is ready (`PendingOpenPaths`, `queue_paths_to_open`, `paths_from_argv`).                                                                                                                                                                               |
| `src/menu.rs`, `src/menu/`                               | The native menu bar: ids and the id → `menu-<id>` event dispatch in `menu.rs`; `build.rs` builds it, `state.rs` keeps labels, checks and accelerators between rebuilds, `recent.rs` Open Recent, `dock.rs` the Dock menu, `plugins.rs` plugins' items.                                                     |
| `src/tab_drag.rs`                                        | Tabs dragged between windows.                                                                                                                                                                                                                                                                              |
| `src/background/`                                        | Background mode (desktop): whether closing the last window keeps the app running, and the tray icon ([lifecycle.md](lifecycle.md)).                                                                                                                                                                        |
| `src/plugins/`                                           | The plugins' backend: installed plugins and their state, the catalog, installing, their files, storage and secrets, the `textus-plugin:` scheme, AI tools, the metadata index, scripts. Each permission is checked again here. Its commands are registered by `with_plugin_commands!` in `plugins/mod.rs`. |
| `src/schedule/`                                          | Plugins' scheduled jobs and notifications, and the hidden `background-host` window that runs them with no window open (desktop).                                                                                                                                                                           |
| `src/conventions/`                                       | What a folder says about how it is written, whichever app made it: link style, picture folder, line breaks, templates, daily, weekly and monthly notes (`folder_conventions`).                                                                                                                             |
| `src/ai/`                                                | The AI client and agent loop, tools, providers (`catalog`), memory, the paper writer (`paper/`), built-in skills, writing conventions and grammar rules (`rules/`), project files, and the live evaluation (`live_eval/`, run on demand - [ai-eval.md](../design/ai-eval.md)).                             |
| `src/auth/`                                              | Provider sign-in and keys.                                                                                                                                                                                                                                                                                 |
| `src/mcp/`                                               | MCP servers: programs or web services that give Textus AI more tools (desktop).                                                                                                                                                                                                                            |
| `src/cli/`                                               | The `textus` terminal command ([cli.md](cli.md)).                                                                                                                                                                                                                                                          |
| `src/extract/`                                           | The Markdown of PDF, Word, PowerPoint, spreadsheet, EPUB, RTF and HTML files, shared by chat attachments and the AI's project tools.                                                                                                                                                                       |
| `src/atomic.rs`, `net.rs`, `walk.rs`                     | Atomic file writes and private temp files; HTTP timeouts and size-capped reads; the one folder walk, shared by the sidebar's search and the AI's project tools.                                                                                                                                            |
| `src/webview_memory.rs`                                  | Windows: a minimized window's WebView2 is asked to use less memory.                                                                                                                                                                                                                                        |
| `src/distribution.rs`, `app_identity.rs`, `ext_stats.rs` | Which channel installed this build; the identity passed to `aicompat`; extension download counts.                                                                                                                                                                                                          |
| `plugins/textus-files/`                                  | Not the plugin system: the iOS document-access Tauri plugin (Swift), compiled only on iOS.                                                                                                                                                                                                                 |
| `crates/aicompat/`                                       | The providers' APIs, the agent loop and its events, with no Tauri in it (a test checks), so it can run outside the app; `src/auth/` and `src/ai/` wrap it.                                                                                                                                                 |
| `capabilities/`, `tauri*.conf.json`                      | Tauri's permissions (`default.json` shared, `desktop.json`, `ios.json`) and configuration per platform.                                                                                                                                                                                                    |

A shape that exists on both sides (`AgentTurn`, `ChatAttachment`,
`StreamEvent`, ...) carries a comment on each side naming the other; change
both together. Desktop-only code is `#[cfg(desktop)]`;
[ios-code-map.md](ios-code-map.md) has the rules.

## Where things meet

`document-view/MilkdownEditor.tsx` (one tab's editor and every AI surface
attached to it) and `app/App.tsx` (the window) are where everything meets,
and are kept as compositions: each calls hooks and renders components that
live beside it (`document-view/use*.ts`, `app/useWindow*.ts`,
`app/frame/Sidebar.tsx`, `app/islands/DocumentIslands.tsx`) or in the feature's own folder
(`ai/margin/useReviewNotes.ts`, `editor/modes/...`). When you add to them,
add a hook or a component the same way - as `WindowBar`,
`useSidePanels` or `useUpdateChecks` are - rather than more code in
the file itself, and keep the hooks' call order.

## The window's Content Security Policy

Every window's page loads under the policy in `src-tauri/tauri.conf.json`
(`app.security.csp`). It keeps the network out of everything a stylesheet
or a document can make the page load - an imported or gallery theme, Custom
CSS, a document's HTML - while the app's own traffic goes through Rust:
the AI providers, the theme gallery, the plugin catalog and the updater all
use `reqwest`, so the page itself never needs a remote origin. A desktop
`npm run tauri dev` loads the Vite page directly, without Tauri's header,
so the dev server sends the same policy (`vite.csp.ts`), and the e2e flows
run under it too. `src/plugins/host/window-csp.test.ts` checks the rules
below.

| Directive     | Allows                                                                                              | Because                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default-src` | `'self'`                                                                                            | Anything not listed: the app's own files only.                                                                                                       |
| `script-src`  | `'self'`, `'unsafe-inline'`, `'wasm-unsafe-eval'`, `data:`, `blob:`, the plugins' files             | A plugin's page is a `srcdoc` frame, which takes the window's policy on top of its own, so the window allows what `webviewCsp` (`frames.ts`) allows. |
| `style-src`   | `'self'`, `'unsafe-inline'`, `data:`, the plugins' files                                            | Themes and Custom CSS are `<style>` elements, and the editor sets `style=""`. No remote `@import`.                                                   |
| `img-src`     | `'self'`, `data:`, `blob:`, the asset protocol, the plugins' files, `https:`, `http:`               | A document shows its pictures from the web as written. A stylesheet's `url()` picture is one too; CSP can't tell the two apart.                      |
| `font-src`    | `'self'`, `data:`, the asset protocol, the plugins' files                                           | KaTeX's fonts are bundled; an imported theme's fonts are inlined as `data:` (`theme-import.ts`). No web fonts.                                       |
| `media-src`   | `'self'`, `data:`, `blob:`, the asset protocol, the plugins' files                                  | What a plugin's page may play.                                                                                                                       |
| `connect-src` | `'self'`, `ipc:` / `http://ipc.localhost`, `data:`, `blob:`, the asset protocol, the plugins' files | Tauri's IPC, and reading a picture's bytes back for export and copy. No `fetch` to the web.                                                          |
| `worker-src`  | `'self'`, `data:`, `blob:`, the plugins' files                                                      | A plugin's page may start a worker from its own files.                                                                                               |
| `frame-src`   | `'self'`, `https:`                                                                                  | The framed web page on Linux and phones, and a plugin page's frames of the hosts the user granted (`webviewCsp` narrows them per plugin).            |
| `object-src`  | `'none'`                                                                                            | No plugins of the old kind.                                                                                                                          |
| `base-uri`    | `'self'`                                                                                            | A `<base>` can't move where relative URLs go.                                                                                                        |

Each scheme appears twice where it is served: `asset:` and
`textus-plugin:` on macOS, Linux and iOS, `http://asset.localhost` and
`http://textus-plugin.localhost` on Windows. `dangerousDisableAssetCspModification`
stops Tauri adding hashes of the pages' inline `<style>` and `<script>` to
the policy: with a hash in a directive the browser ignores
`'unsafe-inline'`, and themes and plugin frames would stop working.
