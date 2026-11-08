# Recipes

Step by step, the files a common change touches. Each recipe names a
recent example to read alongside. Where a step is missed, a check usually
says so; the list is here so you don't have to find out that way.

## Add a setting

Example: `autosave` (**Settings › General › Save automatically**).

1. **The field and its default**: add it to the `Settings` interface and
   to `DEFAULT_SETTINGS` in `src/prefs/settings-types.ts`, with a doc
   comment saying what it means.
2. **Reading it back**: `normaliseSettings` in
   `src/prefs/settings-normalise.ts` starts from the defaults and keeps
   what was stored. A value that can be wrong in a way that matters (one of
   a list, a number in a range, a map) gets a line in `readSettings` that
   checks it: a rejected value takes its default and never drops the rest.
   Add a case to `settings-store.test.tsx` or `settings-file.test.ts` if
   you add a check.
3. **The row**: in the page that holds it, `src/settings/pages/*Page.tsx`
   or a section in `src/settings/sections/`, using `ToggleRow` or
   `SettingRow` from `src/settings/sections/controls.tsx`. Read it with
   `useSettings()` and change it with `setSettings({ field: value })`; the
   change reaches every window and `settings.json` by itself
   ([storage.md](storage.md#how-the-files-are-written)). Settings search
   reads the rows from the page, so the label is found without more work.
4. **Its label** in all ten locales ([below](#add-a-ui-string)).
5. **Rust**, only if the backend needs it: `read_setting(app, "field")` in
   `src-tauri/src/settings/app.rs` returns the stored JSON value. Settings
   that belong to a folder rather than the user (a plugin's values, the
   folder's conventions) go in its `.textus/settings.json` instead
   (`src/storage/project-settings.ts`).
6. **A test** where the setting changes behaviour, in the layer that
   catches it ([testing.md](testing.md)); `openApp(page, { settings: { … } })`
   seeds it in an e2e flow.

## Add a menu item and a shortcut

Example: **View › Mode › Default** (`view-mode-default`). One id names an
item everywhere; the macOS bar is native, Windows, Linux and the iPad draw
the same menu in HTML, and the phone has its own.

1. **The id and what it sends**: in `src-tauri/src/menu.rs`, a constant
   (`const VIEW_MODE_DEFAULT_ID: &str = "view-mode-default";`) and a branch
   in `dispatch` that emits `menu-<id>` to the focused window. The
   app-drawn menu reaches the same `dispatch` through `trigger_menu_item`.
2. **The native item**: build it in `src-tauri/src/menu/build.rs` with
   `item(...)` or, for an on/off item, `check(...)`, with an English
   label; a fixed, OS-convention key is its `.accelerator(...)`. Put it in
   its submenu.
3. **The menu model**: in `src/app/menu/app-menu-model.ts`, add the id to
   `NativeMenuId` and an entry `{ label: t.…, action: { native: "…" } }`
   (with `checked` or `accel` as needed) to `buildAppMenu`, and to
   `buildMobileMenu` if the phone has it. The macOS bar's labels are read
   from this model (`native-menu-text.ts`), so the label is written once.
   An on/off item's state is sent to Rust with the other checks
   (`set_menu_checks`).
4. **What it does**: a handler in the `MenuHandlers` of
   `src/app/menu/menu-bridge.ts`, listening for `menu-<id>`, and its
   implementation where the window wires them (`src/app/useWindowWiring.ts`).
   On iOS the phone menu turns the id into the same event
   (`emitMenuEvent`, `src/platform/menu-events.ts`).
5. **A key the user can change**: add the action to `ShortcutAction` and
   its defaults per platform in `src/prefs/shortcut-defaults.ts`, handle
   it in `src/app/useGlobalShortcuts.ts`, show it on the item (`accel`),
   and give it a row in **Settings › Shortcuts**
   (`src/settings/pages/ShortcutsPage.tsx`).
6. **The key table**: `src/app/key-table.test.ts` lists every shortcut with
   who answers it on each platform (the native menu on macOS takes a key
   before the page does). Add a row; the test fails when two features claim
   one key, or a key the macOS menu takes reaches nothing. Check `Cmd` keys
   in the built app on a Mac.
7. **The command palette** lists every menu item from the model, so it
   needs nothing. A command with no menu item is `registerCommand`
   (`src/app/commands.ts`).
8. **Strings** for the label in all ten locales, and `e2e/` coverage via
   `emit(page, "menu-<id>")`.

## Add a backend command

Example: the draft commands (`src-tauri/src/commands/drafts.rs`,
`drafts` in `src/platform/ipc-files.ts`).

1. **The Rust function**, in the `src-tauri/src/commands/` file of its area
   (or the module that owns the state):

   ```rust
   #[tauri::command]
   #[cfg_attr(test, specta::specta)]
   pub async fn save_draft_snapshot(app: AppHandle, tab_id: String, …) -> Result<(), String>
   ```

   Types it takes or returns carry `#[cfg_attr(test, derive(specta::Type))]`
   and a comment naming their TypeScript side.

2. **Register it** in `run()`'s `invoke_handler` list in
   `src-tauri/src/lib.rs`: in the shared half if iOS has it, else in the
   second half with `#[cfg(desktop)]` in front. A shared command may only
   read state managed in the shared part of `run()`; state that only
   `desktop_builder` manages aborts the iOS app when the page calls it
   ([ios-code-map.md](ios-code-map.md)). Plugin commands are listed in
   `with_plugin_commands!` (`src-tauri/src/plugins/mod.rs`) instead.
3. **Generate its types**: add it to its group in
   `src-tauri/src/bindings.rs` and run `npm run bindings`, which writes
   `src/platform/bindings/<group>.ts`. `cargo test` fails while they are
   stale.
4. **The wrapper**, in the `src/platform/ipc-*.ts` file of its area:
   `command("save_draft_snapshot", tabId, path, content)` from
   `ipc-call.ts`, type-checked against the Rust signature. A desktop-only
   command uses `desktopQueryCommand` (a fallback on iOS) or
   `desktopActionCommand` (rejects on iOS); one that calls an AI service
   uses `aiCommand`. Callers import the area from `platform/ipc.ts`.
5. **The browser stand-in**: under `npm run dev` and in the e2e flows the
   dev shim (`src/dev/tauri-shim.ts`) answers a command it doesn't know
   with `null`. If the frontend needs a real answer there, add a case to
   the shim; a flow can also answer it with `mockInvoke`.
6. **Tests**: Rust unit tests beside the module (inline or in `tests.rs`),
   and the frontend's in the layer that catches its mistake.

## Add a UI string

Every string the user sees is in all ten locale files in
`src/i18n/locales/` (en, zh, zh-Hant, ja, ko, es, fr, de, ru, pt).

1. Add the key to `en.ts` beside the keys of the same feature, not at the
   end of the file. English is the source: its shape is the `Strings` type.
2. Add the same key, translated, at the same place in the nine others.
   `zh-Hant` follows the Taiwan vocabulary; the tone rules are in
   [translating.md](translating.md#tone). If you don't know a language, put
   the English text there and say so in the pull request.
3. The app's and the AI's names come from `src/i18n/names.ts` (`APP_NAME`,
   `AI_NAME`), in a template literal, never written out.
4. A count is a plural object, one entry per plural category of each
   language (`{ one: "{n} file", other: "{n} files" }`); placeholders
   (`{n}`, `{name}`, …) are kept exactly, in every language.
5. Read it as `t.key`, with `t` from `useSettings()` or passed down.
6. `npm test` runs `src/i18n/strings.test.ts`: it fails on a key missing
   from a complete language, a placeholder lost or added, a wrong plural
   form.

If the string names a control the AI should point users to, also check
`src-tauri/src/ai/ui-names/*.txt` and the help guides in `src/help/`:
their tests compare them with the strings.

## Add a plugin API call

Example: `layout.panels()` and `onDidChangePanels` (commit 36709ec9), or
`textus.dates` (pure, in the runtime). The plugin author's view is
[plugins/](plugins/README.md).

1. **The runtime**: add the call to the `textus` object in
   `src/plugins/host/runtime/host.js`, as `call("namespace.method", …)`
   for anything the app answers, or as code in the frame for a pure helper
   (`runtime/text.js`). An event is `on("eventName")`.
2. **The broker**: a handler named `"namespace.method"` in the
   `src/plugins/host/broker-*.ts` file of its namespace (`layoutHandlers`
   in `broker-layout.ts`, …). It checks its arguments with the helpers
   there; a call that reaches the backend goes through
   `src/platform/ipc-plugins.ts` and a Rust command in
   `src-tauri/src/plugins/` that checks the grant again.
3. **The permission**: add the method to its permission in
   `src/plugins/api-permissions.ts`, the one table the broker and the
   install check both read. An event the window sends goes into
   `PluginEventMap` in `src/plugins/app-bridge.ts` (sent with
   `emitPluginEvent`), and its permission, or `null`, into
   `PLUGIN_EVENT_NEEDS` in `src/plugins/host/broker.ts`.
4. **The types**: declare it in `docs/dev/textus.d.ts`, with a doc comment
   ending in its "From X.Y.Z" version. `textus-types.test.ts` fails while
   the runtime and the declarations differ.
5. **The reference**: run `node scripts/plugin-reference.mjs`, which writes
   `docs/dev/plugins/reference.md` and the AI skill's copy from
   `textus.d.ts`; `plugin-reference.test.ts` fails while they are stale.
6. **Create mode's guide**: name the call in
   `src-tauri/src/ai/skills/plugin.md`; `src/plugins/plugin-guide.test.ts`
   fails on a call it doesn't name.
7. **The version**: a release that adds calls raises `API_VERSION` in
   `host.js`, the version in `textus.d.ts`'s header, and the table in
   `docs/dev/plugins/versions.md` (`plugin-docs-facts.test.ts` holds them
   together).
8. **The browser**: if the call reaches a new backend command, the dev
   shim answers it (`src/dev/plugin-shim-api.ts` for files and the index).
9. **A test**: unit tests for the handler or helper, and an e2e flow with
   a plugin for what crosses the frame (`e2e/plugin-text-api.spec.ts` is an
   example; [testing.md](testing.md#the-official-plugins)).

## Add an e2e test

1. Decide it needs a browser: focus, menus, dialogs, scrolling, layout,
   the clipboard. What keys and pastes do to the document is an editor
   integration test instead ([testing.md](testing.md#which-layer-a-test-belongs-in)).
2. Put it in `e2e/<feature>.spec.ts`, named for what it shows. Open the
   window with `openApp` (or `openPhone`, or `openWithPlugins` for plugin
   flows) and seed what it needs: settings, `window.__devFs`, mocked
   commands ([the helpers](testing.md#writing-an-e2e-flow)).
3. Drive it as a user would: clicks, keys, `emit` for a menu item. Wait for
   what you assert on with `expect(...)` or `expect.poll(...)`, never a
   fixed pause; `settled` before measuring where something came to rest,
   `release` to stop a reply or a save half way.
4. A drag uses `swallowHtmlDrop` before `openApp` and `dragWithMouse`, so
   it passes only if it works in the app's window.
5. Only if WebKit behaves differently there, add the file to
   `WEBKIT_SPECS` in `playwright.config.ts`. A flow that times frames is
   tagged `@perf` and never runs in CI.
6. Run it until it is stable: `npx playwright test e2e/x.spec.ts
--repeat-each=20 --workers=4`, with `PLAYWRIGHT_PORT` set if another
   copy may be running. Check that it fails without the fix.

## Where platform-specific code goes

- **What a platform can do** is a flag in `src/platform/capabilities.ts`
  (`canUseWindows`, `hasAppMenu`, `canExportPdf`, `hasTextusAi`, …);
  callers read the flag, never the OS. A new flag gets a comment saying
  why the platform differs.
- **Asking `isIOSApp` directly** is allowed only in the files listed in
  `src/platform/ios-gates.test.ts`, each with its reason; most needs belong
  in a flag or in the phone layout instead.
- **The phone layout**: `usePhoneLayout()` (`src/ui/usePhoneLayout.ts`) in
  components, and CSS in `src/mobile/styles/`, every selector starting
  with `:root[data-window-chrome="mobile"]`.
- **OS facts** (a Mac's `Cmd`, Windows' window frame) are in
  `src/platform/os.ts` (`modIsMeta`, `isWindowsPlatform`,
  `isLinuxPlatform`).
- **Rust**: `#[cfg(desktop)]` / `#[cfg(mobile)]` for what iOS can't do,
  `#[cfg(target_os = "…")]` for one OS; permissions in
  `src-tauri/capabilities/` (`desktop.json` is desktop only); configuration
  in `tauri.<platform>.conf.json`.
- **Old engines**: CSS newer than Chromium 105 goes behind `@supports`
  for WebView2 ([webview-support.md](webview-support.md)).
- **Input methods on Linux**: WebKitGTK commits a composition as
  `deleteCompositionText` then `insertFromComposition`; keep that in mind
  in `src/editor/keys/`.
- Check it on the platform: CI builds every platform, but windows, dialogs,
  drag and drop, input methods and printing are judged in the built app.
