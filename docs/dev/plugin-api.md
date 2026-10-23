# The app's registries

**Writing a plugin? See [writing-plugins.md](writing-plugins.md)** - this
page is about the inside of the app.

The places a plugin adds to the app are four registries, each a plain list
the app reads instead of a hard-coded set; a plugin's manifest is turned
into entries in them (src/plugins/manager.ts). This page describes them
for code in the app itself.

All four are gathered in [`src/plugin-api.ts`](../../src/plugin-api.ts). A
development build (`npm run dev`) puts the same object on
`window.__textusPlugins`, so you can try an extension from the console;
`e2e/plugin-api.spec.ts` does exactly that. Every `register` returns the
function that takes back what it added.

## Commands

[`src/app/commands.ts`](../../src/app/commands.ts)

```ts
const remove = pluginApi.commands.register({
  id: "example.word-count", // namespaced by its owner
  title: (t) => "Count words", // t: the interface's strings
  run: () => {
    /* ... */
  },
  shortcut: "mod+alt+9", // optional, as Settings writes combos
  enabled: () => true, // optional: whether it can run now
});
pluginApi.commands.run("example.word-count");
```

- A command's shortcut runs it from anywhere in the window, unless one of
  the app's own shortcuts already has that combo: the app's always win.
- An id that is already taken is refused (an exception), never replaced.
- The app's own actions are not commands yet. They keep their menus,
  shortcuts and Settings rows as they are.

## The editor's right-click menu

[`src/editor/editor-menu.ts`](../../src/editor/editor-menu.ts), `registerEditorMenuItems`

```ts
pluginApi.editorMenu.register(({ selectedText }) => [
  { label: "Look it up", onSelect: () => lookUp(selectedText) },
]);
```

- The provider is asked each time the menu opens, with the text selected
  (empty for none), and returns the items to show now - none is fine.
- Its items are a group of their own, after Paste and before Select All.
- A provider that throws adds nothing; the menu still opens.
- The phone's "More" sheet doesn't show them yet.

## Sidebar tabs

[`src/app/sidebar-tabs.tsx`](../../src/app/sidebar-tabs.tsx)

```ts
pluginApi.sidebarTabs.register({
  id: "example.notes",
  label: (t) => "Notes",
  Icon: NotesIcon, // a component drawing a 15px icon
  Panel: NotesPanel, // a component given SidebarTabProps
});
```

- A tab is added after Files, Outline and Clipboard.
- Its panel is given `SidebarTabProps`: the document shown (`activePath`,
  `activeContent`), the folder (`openFolder`), and ways to open a file or
  close the sidebar.
- The tab last shown is remembered by its id. A tab that is gone the next
  time opens Files instead.

## Settings pages

[`src/settings/settings-pages.tsx`](../../src/settings/settings-pages.tsx)

```ts
pluginApi.settingsPages.register({
  id: "example",
  label: (t) => "Example",
  Page: ExamplePage, // a component given SettingsPageProps
  available: () => true, // optional: left out where it means nothing
});
```

- A page is added after the built-in ones, in the navigation and on the
  phone's tabs.
- It is given `SettingsPageProps`: the settings and their setter, the
  strings, and the panel's ways out (`setSubpage`, `openHelp`,
  `onOpenFile`).
- Built from the same rows as the built-in pages (`SettingRow`,
  `ToggleRow`, `SettingsGroup`), it looks like them. Its rows are found by
  Settings' search too.
- A plugin's own settings will need storage of their own; for now a page
  can only show and change the app's.

## Themes

Themes are already open to everyone, and need no plugin: a Typora-style
CSS file restyles the document, and the interface follows it. Every colour
in the window comes from a variable a theme can set on its `:root`; the
variables are listed in
[docs/design/design-language.md](../design/design-language.md).

## What 1.3 adds

- **Loading.** A plugin is a folder with a manifest: its id, name,
  version, what it needs, and its entry script. Textus loads it in a frame
  of its own and hands it this API, never the app's internals.
- **Permissions.** What a plugin may do is declared in its manifest and
  asked for on install:
  - read the document, change it (as proposals the user accepts), or read
    the folder;
  - reach the network, and which hosts;
  - run its own views.
- **Views.** A plugin can open:
  - a panel or a tab of its own - a web page, a PDF, a reader for Word or
    other formats - beside the documents;
  - a viewer for a file type the editor doesn't open.
- **The app menu.** Commands in the window's menu. On a Mac that menu is
  native (src-tauri/src/menu.rs), so it takes a step in Rust; for now,
  commands reach the right-click menu and shortcuts only.
- **The market.** One place to find themes, plugins and skills, kept in a
  repository of its own, with written rules for what is accepted and how
  it is reviewed.
