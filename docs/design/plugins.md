# Plugins and the market (design, 1.3)

Status: sections 1-6 are built in 1.3.0-beta.1, on the registries that
shipped in 1.2 ([docs/dev/plugin-api.md](../dev/plugin-api.md)); a
plugin's author reads [docs/dev/writing-plugins.md](../dev/writing-plugins.md).
The market (section 7), `aiTools`, `slashCommands`, `codeBlockRenderers`,
importers, exporters, templates and plugin themes come in later betas.
The model is VS Code's - a manifest that declares what a
plugin adds, code that loads only when it is needed, an extension host apart
from the window, webviews for anything a plugin draws - adapted to an
editor that must stay small, fast and safe with a writer's documents.

Principles, from the roadmap:

- Nothing runs unless installed; one switch turns every plugin off.
- A plugin gets only the permissions granted at install, asked again when
  an update wants more.
- Installed plugins load on first use: startup with fifty is startup with
  none.
- A plugin that fails or is slow is turned off and says why.
- A plugin never changes a document by itself: an edit is a proposal the
  user accepts, as Textus AI's are.

## 1. What a plugin is

No plugin ships inside the app. The official ones are published from
CatVinci-Studio/textus-plugins - each version a release with its zip, and a
catalog (`index.json`) listing them with their SHA-256 - and Settings ›
Plugins › Get plugins installs one from there: Rust fetches the catalog
from a fixed address, downloads the package, checks it and installs it
into the app's data folder, `plugins/<id>/`, marking it Official in
`state.json` when the catalog says it is CatVinci's (src-tauri/src/plugins/
catalog.rs). Others install from a file or, in developer mode, a folder.
All are the same kind of plugin, run the same way.

A folder (or a `.textusplugin` zip of one) with a manifest,
`textus-plugin.json`, and its built code.

```jsonc
{
  "id": "catvinci.pdf-viewer", // publisher.name, lowercase
  "name": "PDF Viewer",
  "version": "1.0.0",
  "publisher": "catvinci",
  "description": "Open PDFs in a tab, beside your notes.",
  "icon": "icon.png",
  "license": "MIT",
  "repository": "https://github.com/catvinci-studio/textus-pdf-viewer",
  "engines": { "textus": "^1.3.0" },
  "main": "dist/host.js", // runs in the plugin host (section 3)
  "activationEvents": [
    "onCustomEditor:catvinci.pdf",
    "onCommand:catvinci.pdf.open",
  ],
  "permissions": ["workspace.read"],
  "contributes": {/* section 2 */},
}
```

`activationEvents` follow VS Code's: `onCommand:`, `onView:`,
`onCustomEditor:`, `onFileType:`, `onSettingsPage:`, `onSlashCommand:`,
`onStartupFinished` (discouraged; the market review asks why).

## 2. What a plugin can add (`contributes`)

Declared in the manifest, so the app can show it before any plugin code
runs. More than VS Code where a writing app needs it; less where it would
let a plugin break the editor.

| Contribution              | What it is                                                                                                                                                                                  | Built on               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `commands`                | An action with a title and icon                                                                                                                                                             | commands.ts            |
| `keybindings`             | A default shortcut for a command; the user can rebind it in Settings › Shortcuts                                                                                                            | commands.ts            |
| `menus`                   | Where commands appear: `editor/context`, `editor/title` (the tab bar), `sidebar/title`, `app/plugins` (a Plugins menu in the menu bar), `file/explorer` (the file tree's menu), `statusBar` | editor-menu.ts, new    |
| `sidebarTabs`             | A tab in the sidebar, its panel a webview                                                                                                                                                   | sidebar-tabs.tsx       |
| `views`                   | A panel beside the document, or a tab of its own (like a document tab)                                                                                                                      | new: view slots        |
| `customEditors`           | Open a file type in a tab: PDF, Word, images, SVG, CSV                                                                                                                                      | new: open-with         |
| `configuration`           | Settings, declared as a schema; Textus draws the rows                                                                                                                                       | settings-pages.tsx     |
| `settingsPage`            | A page of its own in Settings, a webview, for what a schema can't say                                                                                                                       | settings-pages.tsx     |
| `themes`                  | Document and interface themes (CSS), as the market's themes are                                                                                                                             | theme/                 |
| `skills`                  | Skills for Textus AI (`.md`)                                                                                                                                                                | ai/skills              |
| `aiTools`                 | Tools Textus AI may call - read-only or proposing - when the user allows it per plugin                                                                                                      | ai tools registry, new |
| `slashCommands`           | `/name` in the AI composer and the editor                                                                                                                                                   | new                    |
| `codeBlockRenderers`      | Draw a fenced block of a language (` ```chart `) in the preview and in exports                                                                                                              | new, like Mermaid's    |
| `exporters` / `importers` | A format to export to or open from                                                                                                                                                          | export/, new           |
| `templates`               | New-document templates                                                                                                                                                                      | new                    |
| `statusBar`               | An item in the window bar's status group                                                                                                                                                    | new                    |

Not offered, on purpose: changing the editor's schema or keymaps, reading
other plugins' data, running native code, drawing over the document.

## 3. Sandbox

Three kinds of place a plugin's code runs, none of which can reach the app:

1. **The plugin host** - VS Code's extension host. One hidden
   `<iframe sandbox="allow-scripts">` per plugin, started on its first
   activation event and removed when the plugin is disabled. Without
   `allow-same-origin` it has an opaque origin: no access to the app's
   storage, cookies, DOM or `window.__TAURI__`. It is written as `srcdoc` -
   the API's runtime and the plugin's `main`, read from its folder by the
   broker - under a Content Security Policy of its own, `default-src 'none';
script-src 'unsafe-inline'`: no network, no other script. Everything goes
   through the API (section 4). (A Worker made from a blob would share the
   app's origin; the sandboxed frame doesn't.)
2. **Webviews** - what a plugin draws (a sidebar panel, a view, a custom
   editor, a settings page). The same kind of sandboxed frame, its HTML the
   plugin's own, set from the host as VS Code's `webview.html` is. A file of
   the plugin's - a script, a stylesheet, an image - is handed in by
   `webview.asWebviewUri(path)`, which the broker answers with a `data:` or
   `blob:` URL of that file, read from the plugin's folder only. Its CSP
   allows inline and `data:`/`blob:` scripts, styles and images, and frames
   (`frame-src`) only for a plugin granted the network for that host - the
   web view. Textus injects its theme variables into each webview, and a
   small UI kit (`@textus/plugin-ui`: buttons, rows, inputs, the same CSS as
   Settings), so a plugin's view looks like Textus and follows the theme
   and dark mode.
3. **Renderers** (`codeBlockRenderers`) - run in the plugin host; they return
   SVG or HTML that Textus sanitizes (the same sanitizer as raw HTML in
   documents) before it goes into the page.

Watchdog, in the app (the broker, section 4):

- every host answers a ping within 2 s; one that doesn't, or throws on
  activation, or errs more than 10 times a minute, is stopped, disabled, and
  the user is told which plugin and why (with "Turn back on" and "Report");
- every API call has a timeout; a webview's messages are rate-limited;
- a plugin's storage has a quota (50 MB), and its webviews are destroyed
  when their slot closes.

## 4. Communication

JSON-RPC 2.0 over `MessageChannel`, one channel per host and per webview,
the app at the centre as the **broker**:

```
webview  ⇄  broker (app window)  ⇄  plugin host (worker)
                    ⇅
              Rust (privileged calls)
```

- The broker owns every channel. It checks each call against the plugin's
  granted permissions before doing anything, and hands privileged work to
  Rust through plugin-scoped commands (section 5).
- Messages are structured-clone data only, typed by the
  `@textus/plugin-api` package: a `.d.ts` of the whole API and a small
  runtime that turns `textus.workspace.readFile(...)` into an RPC call.
  Events (`onDidChangeActiveDocument`, `onDidSave`, `onDidChangeSelection`,
  `onDidChangeTheme`) are subscriptions the broker pushes.
- A webview talks to its own plugin's host only
  (`textus.postMessage` / `onDidReceiveMessage`, as VS Code's webviews do),
  never to the app directly.
- The API is versioned by `engines.textus`; a plugin asking for a version
  this Textus doesn't have isn't loaded, and Settings says why.

The API, by namespace (first version):

| Namespace   | Calls                                                        | Permission         |
| ----------- | ------------------------------------------------------------ | ------------------ |
| `commands`  | register, execute                                            | -                  |
| `window`    | showMessage, showQuickPick, showInput, createView, setStatus | -                  |
| `document`  | getText, getSelection, getPath, onDidChange                  | `document.read`    |
| `document`  | proposeEdit (shown as a proposal the user accepts)           | `document.propose` |
| `workspace` | listFiles, readFile, stat, onDidSave                         | `workspace.read`   |
| `workspace` | writeFile, createFile (in the folder only)                   | `workspace.write`  |
| `storage`   | get/set its own data and settings, secrets in the keychain   | -                  |
| `net`       | fetch, to the hosts listed                                   | `network:<host>`   |
| `clipboard` | read, write                                                  | `clipboard`        |
| `ai`        | ask Textus AI with the user's model                          | `ai`               |
| `editor`    | registerCodeBlockRenderer, registerSlashCommand              | -                  |

## 5. Permissions in the backend

- **Granting.** On install the manifest's `permissions` are shown in plain
  words; the user grants all or cancels, and can revoke one later in the
  plugin's Settings page. Grants live in Rust, in the app data folder:
  `plugins/state.json` - per plugin its version, enabled, granted
  permissions and the folders it was given.
- **Enforcement in Rust.** A plugin's privileged calls are Tauri commands
  that take the plugin id and check the grant there, not in the frontend:
  - `plugin_fs_read` / `plugin_fs_write`: the path canonicalised and
    required to be inside the open folder (or one granted explicitly),
    never the app's own data, never another plugin's;
  - `plugin_http`: the host must be in the plugin's `network:` list, HTTPS
    only (plain HTTP for localhost if declared), no cookies, a size limit;
  - `plugin_storage_*`: the plugin's own folder, `plugins/<id>/data/`,
    with its quota; secrets in the keychain under `textus-plugin:<id>`.
- **Updates.** An update that asks for more is installed but left disabled
  until the user grants the new permissions.
- **Proposals, not edits.** `document.propose` goes through the same
  pending-edit path as Textus AI: shown in place, accepted or rejected by
  the user, undoable.
- **AI.** A plugin's `aiTools` are offered to Textus AI only when the user
  allows that plugin in the conversation's tools, and only read or propose.
  `ai` lets a plugin ask the user's model; the request is marked as the
  plugin's in the chat history.
- **The switch.** Settings › Extensions › Plugins › "Turn off all plugins" stops every
  host and webview at once; a launch with `--no-plugins` (or holding Shift
  on start, desktop) starts without them, for when one goes wrong.

## 6. In Settings

A **Plugins** page in Settings (a built-in page in settings-pages.tsx):

- At the top: **Plugins** on/off (the switch above), and **Browse the
  market…** (opens the market, section 7).
- **Installed**: one row per plugin - icon, name, publisher, version, a
  switch, and its state (off, needs permission, turned off because it
  failed: "PDF Viewer stopped answering - Turn back on"). Clicking a row
  opens its page.
- **A plugin's page** (a subpage, as More themes is):
  - what it adds (commands, views, file types), its permissions with
    Revoke beside each, the folders it may read;
  - its settings, drawn from its `configuration` schema with the same rows
    as Textus's own (a boolean is a switch, an enum a select, a string or
    number a field), then its own `settingsPage` if it has one;
  - Update / Disable / Uninstall, its storage use, "Report a problem"
    (opens the plugin's repository issues).
- **Developer**: **Load a plugin folder…** (developer mode), which loads an
  unpacked plugin and reloads it when its files change.
- A plugin's shortcuts appear in Settings › Shortcuts under its name, and
  can be changed there like the app's own.
- Themes stay under **Editor & Appearance › More themes**, whose **Browse
  themes** shows the market's themes.

Search in Settings finds plugins' setting rows too.

## 7. Extensions: where each kind comes from

Settings › Extensions has a tab for each kind of thing added to Textus,
each one a card with its switch (src/settings/pages/ExtensionsPage.tsx).
Each kind comes from where it is simplest to keep and to review:

| Kind    | Where it comes from                                                                           | Installed as                                       |
| ------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Plugins | `CatVinci-Studio/textus-plugins`: its `catalog` release's `index.json`, one release a version | a zip, checked by SHA-256, unpacked by Rust        |
| Themes  | `CatVinci-Studio/textus-themes` (the website's gallery), sent in as a GitHub comment          | one CSS file, a user theme                         |
| Skills  | built into the app (src-tauri/src/ai/skills/); the user's own are files                       | a switch: five on in a new profile, the rest added |
| MCP     | anything with an MCP server; four common ones are ready to add (src/settings/mcp.ts)          | a command or a URL in `mcpServers`                 |

A plugin or theme someone else wrote is reviewed before it is listed: a
pull request on textus-plugins, a maintainer's `/approve` on the theme
issue. Skills stay in the app for now - a few kilobytes of text each -
and are made optional by their switches; a catalog of skills written by
others can come later in the same shape as the plugins'. MCP servers are
the user's own choice of program or service: nothing is listed that the
user didn't add, and a server's tools reach the model only while its
switch is on (src-tauri/src/mcp/).

## 8. Order of work (betas on `main`)

1. **beta.1** - manifest, loader, plugin host and webviews, the broker and
   JSON-RPC, permissions in Rust, Settings › Extensions › Plugins, developer mode; the
   PDF viewer and version history as the first official plugins.
2. **beta.2** - the market repository, its checks and publishing, the
   in-app market and install flow, the website's market; themes moved over.
3. **beta.3** - the other official plugins, `aiTools`, `/plugin` (Textus AI
   writes a plugin), the template repository and `@textus/market` CLI.
4. **1.3.0**.
