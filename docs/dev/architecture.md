# Architecture

Where things live and which way the dependencies point. Read this before
adding a folder or an import that crosses one. The other documents go deeper
on one area each: [AI-PROPOSALS.md](../design/ai-proposals.md) (an AI edit from stream
to document), [AI-CONCEPTS.md](../design/ai-concepts.md) (project folder, style
profile, library, skills), [STORAGE.md](storage.md) (what is saved where),
[TESTING.md](testing.md) (what each suite covers).

Textus is a Tauri 2 app: a React + Milkdown (ProseMirror) frontend in `src/`
and a Rust backend in `src-tauri/`. They talk only through
`src/platform/ipc.ts` on one side and `src-tauri/src/commands/` (plus
`ai/` and `auth/`) on the other.

## Frontend layers

`src/` is grouped by feature, and the features are stacked in layers. A
folder imports from its own layer and the layers below it, never above.
ESLint enforces this (`no-restricted-imports` in `eslint.config.js`); a
type-only import may cross, since it leaves nothing behind at runtime.

```
5  app/                window shell: App, tabs, window bar, app menu, shortcuts
   plugins/            the plugin system: plugs into the shell's commands, tabs, panes
   playground/         the browser playground: the editor core in a web page
   document-view/      the document on screen: MilkdownEditor + its AI, assembled
4  ai/  editor/  export/  sidebar/  mobile/  onboarding/  document/  clipboard/
   settings/  theme/   features (editor is below ai: ai builds on it)
3  ui/                 shared widgets: dialogs, Select, icons, sheets, motion
2  storage/            persisted state: settings file, ui-state, history lists
1  platform/  i18n/  utils/   the backend bridge, OS facts, strings, pure helpers
```

Inside layer 4, `editor/` never imports `ai/`, `document/`, `export/`,
`sidebar/`, `mobile/` or `onboarding/`: the Markdown editor works on its own,
and the features attach to it, not the other way round. `main.tsx` picks the
window to render (the editor window, or the detached chat window).

`plugins/` belongs with the shell: it registers what plugins add into the
app's own registries (`app/commands.ts`, `app/sidebar-tabs.tsx`,
`app/split/split-layout.ts`). Features use it only through its front -
`plugins/manager.ts` (records, install, turning on and off),
`plugins/app-bridge.ts` (what the window lends plugins) and
`plugins/views/plugin-views.tsx` (what draws them, loaded lazily). Its
inside is in folders by job:

| `plugins/`       | Holds                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `host/`          | Running a plugin: the sandboxed frames, the runtimes put in them (`runtime/`), the broker that answers every call (`broker*.ts`), the RPC.       |
| `contributions/` | The registries of what plugins add: commands and menus, code blocks, decorations, completions, hover cards, links, lists, AI tools, before-save. |
| `views/`         | What draws plugins: webviews, lists, web pages, forms, the theme given to a page.                                                                |
| `store/`         | What is installed and how: manifests, the catalog, records and their state, permissions, settings, logs, export, migration.                      |
| `workspace/`     | What plugins know of the folder: the metadata index, globs, front matter, links that follow a rename.                                            |

Only the plugin system imports `plugins/host/` - ESLint refuses it
anywhere else - so the sandbox can change without the app noticing.

## Checked on every change

`npm run check` holds the code to these, so they stay true without anyone
remembering them:

- **Layers**: a folder imports from its own layer and the ones below
  (ESLint, `no-restricted-imports`), and nothing outside `plugins/` reaches
  into `plugins/host/`.
- **No import cycles**: no module imports itself through others
  (`scripts/check-cycles.mjs`). A cycle ties its modules into one: none can
  be read, tested or loaded lazily on its own.
- **No dead code**: no unused file, export or dependency (`knip`, set up
  in `knip.json`).
- **Shape**: no file over 600 lines, no component with more than eight
  hooks (`scripts/check-code-shape.mjs`) - split by concern, as
  `MilkdownEditor` and `App` were.
- **Startup**: what loads with the window stays within its budget
  (`e2e/lazy-loading.spec.ts`); heavy parts load on first use
  (`lazy/lazy-module.ts`).
- **The plugin API**: `docs/dev/textus.d.ts` matches the runtime
  (`textus-types.test.ts`), and the reference page is made from it
  (`plugin-reference.test.ts`).

## What each folder holds

| Folder           | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`           | `App.tsx` (the window's composition) and the hooks it calls (open / save / close, side panels, zen, source modes), `WindowBar`, global shortcuts, zoom, update notice. `tabs/` is the tab bar, the tabs' state and tab drag between windows; `split/` two documents at once (the layout, the divider, drag to split, restoring it); `menu/` the app-drawn menu (`AppMenu`, `app-menu-model`), native menu events (`menu-bridge`) and what the macOS bar is sent. `App.css` is the main window's ordered stylesheet index. |
| `document-view/` | `MilkdownEditor.tsx` - one tab's editor with everything attached (AI panel, Quick Ask, review margin, grammar card, tutorial hooks). `editor-extensions.ts` puts the editor core and the AI plugins together. `EditorPane` switches between WYSIWYG, source and split view. `plugins/` is what plugins do in the editor: their code blocks and marks drawn, their edits placed, what they are told of it.                                                                                                                 |
| `document/`      | A document's life outside the editor: the tab model (`doc-tabs`), draft autosave and recovery, Save Automatically (`autosave`), restoring the last session, reloading after an outside change, default file names, the iPhone's recent-documents list.                                                                                                                                                                                                                                                                    |
| `editor/`        | The Markdown editor. Core plugins register in `editor-extensions.ts`, in load order. Subfolders by feature: `markdown/` (parse, save, paste, front matter, alerts, render to HTML), `marks/` (Typora-style inline delimiters), `math/`, `code/`, `tables/`, `images/`, `html/`, `find/`, `modes/` (source, split, typewriter, zen), `keys/` (key handling per platform). Diagrams are `mermaid-plugin`, drawn by Mermaid or Pele through `diagram-engine`.                                                                |
| `ai/`            | Everything Textus AI. `editor-plugins.ts` registers its plugins on the editor. `chat/` is the conversation shared by the three chat surfaces and its history, with `chat/quick-ask/` (in the text), `chat/panel/` (docked panel, Memory tab) and `chat/window/` (detached window). `revision/` turns a proposed edit into decided sentences; `margin/` draws revisions and review notes beside the text; `writing/` is completion and grammar check; `skills/` the built-in skills and their translations.                |
| `export/`        | File > Export: PDF and HTML from the rendered page (`exporters`, `paginate`, `print.css`), everything else through pandoc (`pandoc-markdown` rewrites what pandoc can't read; `diagram-images` draws diagrams as pictures for Word, OpenDocument, EPUB and RTF).                                                                                                                                                                                                                                                          |
| `theme/`         | How documents look and how themes are read: built-in themes, the document CSS (`content-base.css`, `content-themes.css`), importing a Typora theme (`theme-import`, `typora-compat`), installing one from the public theme gallery (`theme-gallery`) or from an AI reply (`chat-theme`), deriving window colours from it (`theme-chrome`), exporting one (`theme-export`), and putting the appearance settings on the page (`apply-appearance`).                                                                          |
| `settings/`      | The settings model and store (`SettingsContext`, `settings-sync`), the Settings window and its sections.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `sidebar/`       | File tree, outline, clipboard history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `clipboard/`     | The clipboard history: the list and the editor plugin that records copies.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `mobile/`        | Phone-only screens: the document list and the keyboard toolbar; `styles/` holds the phone layout's CSS.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `onboarding/`    | First-run language picker and the tutorial.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ui/`            | Widgets any feature may use: app dialogs, `Select`, icons, `ActionSheet`, `BottomCard`, presence and FLIP animation, window caption buttons. `base.css` holds the design tokens, fonts and palettes every window loads first; `design-system.css` the radii and sizes contract.                                                                                                                                                                                                                                           |
| `storage/`       | Persisted state through the backend: boot snapshot, pending writes, ui-state, persisted lists, the legacy browser-storage import.                                                                                                                                                                                                                                                                                                                                                                                         |
| `platform/`      | `ipc.ts` (every backend command, typed), OS and capability facts, window chrome, iOS file access, menu events.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `i18n/`          | The UI strings (`locales/`), language names and plural rules. See [TRANSLATING.md](translating.md).                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `utils/`         | Pure helpers (paths, CJK, word count, shortcuts, events) and small React hooks (`hooks/`).                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `dev/`           | The browser shim that stands in for Tauri under `npm run dev` and the end-to-end tests, and a test helper.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `help/`          | The bundled Markdown and AI guides, one file per language.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Tests sit next to the file they test (`x.ts` and `x.test.ts`). End-to-end
tests are in `e2e/`.

## CSS

- Component CSS lives next to its component and is imported by it.
- The main window's own layout is `app/App.css`, a list of `@import`s in
  cascade order: the base tokens, then the window bar, sidebar, tabs, text
  column, notices, dialogs, sidebar panels, print rules and modes. Later
  files win ties, so keep print rules after what they hide and the modes
  last. Each piece lives in the folder of the feature it styles.
- The document's look is `theme/content-base.css` (a cascade layer, so an
  imported Typora theme or the user's Custom CSS wins over it) plus
  `theme/content-themes.css` (built-in themes as CSS variables) and
  `editor/milkdown-theme.css` (what makes the editor work: carets, markers,
  previews - not in the layer, so a theme can't break them).
- An imported theme is CSS text: `theme-import.ts` inlines its `@import`s
  and assets, `typora-compat.ts` adapts Typora selectors, and
  `theme-chrome.ts` reads its colours to tint the window around it.

## Backend (`src-tauri/`)

| Path                                                                                      | Holds                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib.rs`                                                                              | App setup: plugins, windows, the command list.                                                                                                                                                                                                                                                                                                                             |
| `src/commands/`                                                                           | Commands the frontend calls, one file per area (files, export, drafts, session, chat window, attachments...).                                                                                                                                                                                                                                                              |
| `src/background/`                                                                         | Background mode (desktop): whether closing the last window keeps the app running, the tray icon. [lifecycle.md](lifecycle.md) tells the story.                                                                                                                                                                                                                             |
| `src/ai/`                                                                                 | The AI client and agent loop, tools, providers (`catalog`), built-in skills, writing conventions and grammar rules (`rules/`), project files (`project`, `workspace`), and the live evaluation harness (`live_eval/`, run on demand - see [AI-EVAL.md](../design/ai-eval.md)).                                                                                             |
| `src/auth/`                                                                               | Provider sign-in and keys.                                                                                                                                                                                                                                                                                                                                                 |
| `src/settings.rs`, `menu.rs`, `tab_drag.rs`, `atomic.rs`, `net.rs`, `walk.rs`, `extract/` | The settings file, the native menu, tabs dragged between windows, atomic file writes and private temp files, HTTP timeouts and size-capped reads, the folder walk shared by the sidebar's file search and the AI's project tools, and the Markdown of PDF, Word, PowerPoint, spreadsheet, EPUB, RTF and HTML files, shared by chat attachments and the AI's project tools. |
| `plugins/textus-files/`                                                                   | The iOS document-access plugin.                                                                                                                                                                                                                                                                                                                                            |
| `crates/aicompat/`                                                                        | Provider sign-in (PKCE) and completion API calls, with no Tauri in it; `src/auth/` and `src/ai/` wrap it.                                                                                                                                                                                                                                                                  |

A shape that exists on both sides (`AgentTurn`, `ChatAttachment`,
`StreamEvent`, ...) carries a comment on each side naming the other; change
both together.

## Where things meet

`document-view/MilkdownEditor.tsx` (one tab's editor and every AI surface
attached to it) and `app/App.tsx` (tab state and the window's commands) are
where everything meets, and are kept as compositions: each calls hooks and
renders components that live beside it (`document-view/use*.ts`,
`app/use*.ts`, `app/Sidebar.tsx`, `app/MainPane.tsx`...) or in the feature's
own folder (`ai/margin/useReviewNotes.ts`, `editor/modes/...`). Both were
split this way in 1.0.2, from about 2,260 and 1,520 lines. When you add to
them, add a hook or component in the same way - as `WindowBar`,
`useDraftAutosave` or `useApplyAppearance` are - rather than more code in
the file itself, and keep the hooks' call order.
