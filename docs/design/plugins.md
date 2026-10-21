# Plugins and the market (design, 1.3)

Status: proposal for 1.3.0. The registries it builds on shipped in 1.2
([docs/dev/plugin-api.md](../dev/plugin-api.md)); everything else here is
to be built. The model is VS Code's - a manifest that declares what a
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

Official plugins ship inside the app (`plugins/official/`, bundled with the
frontend) and are installed but switched off until the user turns one on;
others are installed from the market or a folder into the app's data
folder, `plugins/<id>/<version>/`. Both are the same kind of plugin, run the
same way.

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
- **The switch.** Settings › Plugins › "Turn off all plugins" stops every
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

## 7. The market

One market for **themes, plugins, skills and MCP servers**, in its own
repository, `CatVinci-Studio/textus-market`, in the way Obsidian's
community list works: the market holds the index and the review; the code
lives in each author's repository and is fetched from its tagged releases.

```
textus-market/
  themes/<id>/entry.json, theme.css, preview-light.png, preview-dark.png
  plugins/<id>/entry.json
  skills/<id>/entry.json, skill.md
  mcp/<id>/entry.json
  revoked.json        # taken down: id, versions, reason
  RULES.md            # what is accepted, and how it is reviewed
  scripts/, .github/workflows/
```

`entry.json` names the id, kind, name, author, description, license, source
repository, and for each version its release asset's URL and sha256, the
permissions it asks for and the Textus versions it works with.

### Sending something in

1. **Start** from a template repository - `textus-plugin-template`
   (`Use this template` on GitHub): the manifest, the API types, a webview
   example, a build and `npm run package`, which makes the
   `.textusplugin` zip. A theme needs no template: a CSS file and two
   screenshots.
2. **Try it** in Textus: Settings › Plugins › Developer › Load a plugin
   folder.
3. **Release** it: tag a version in your own repository, attach the zip.
4. **Fork `textus-market`** and add your entry - by hand, or with
   `npx @textus/market add <your repo>`, which fills `entry.json` from your
   latest release (URL, sha256, permissions from the manifest). Open a pull
   request.
5. **Checks** (the market's CI): the schema; the asset downloads and its
   sha256 matches; the manifest matches the entry; no remote code is loaded
   (no `eval`, no script from a URL); a permission diff against the last
   version; a license is named; for themes, Playwright renders the sample
   document in light and dark and posts the screenshots on the pull request;
   the theme-reach check (every colour a variable) as a warning.
6. **Review** by a maintainer, against `RULES.md`. Merged, the entry is
   live.
7. **Updates** are a pull request changing the version (the CLI does it).
   An update that asks for more permissions is reviewed again and, in the
   app, waits for the user's grant.

### Publishing

On every merge, the market's workflow builds `index.json` (every entry's
latest compatible versions) and `revoked.json`, signs them, and uploads them
to the download bucket (`textus.catvinci.com/market/`). The app reads them
from there - never from GitHub at run time - checks the signature, and
verifies each download's sha256 before unpacking it into
`plugins/<id>/<version>/`. It reads `revoked.json` on launch and daily, and
turns off a revoked plugin with the reason.

### On the website

`textus.catvinci.com/market` replaces `/themes`: built from the same
`index.json` whenever the market changes (the market's workflow triggers
the website's build).

- Tabs: Themes, Plugins, Skills, MCP; search; sort by new or popular.
- A card per entry: preview (themes show light and dark), name, author,
  one line, its permissions as small badges.
- An entry's page: its README, screenshots, versions and their notes,
  permissions in plain words, source, license, and **Open in Textus**
  (`textus://market/install?id=…`, which opens the install dialog in the
  app) beside a manual download.
- Install counts come from anonymous download counts on the bucket, never
  from the app.

### Themes

The current gallery's themes and the ones shared in the pinned issue move
into `themes/`, with their screenshots made by the market's CI. Sharing a
theme becomes the same pull request as any entry, made easy:
**Editor & Appearance › More themes › Share this theme…** fills an entry
(the CSS, a name, screenshots taken by Textus) and opens the pull request
page in the browser. A plugin can carry themes too (`contributes.themes`).

## 8. Order of work (betas on `main`)

1. **beta.1** - manifest, loader, plugin host and webviews, the broker and
   JSON-RPC, permissions in Rust, Settings › Plugins, developer mode; the
   PDF viewer and version history as the first official plugins.
2. **beta.2** - the market repository, its checks and publishing, the
   in-app market and install flow, the website's market; themes moved over.
3. **beta.3** - the other official plugins, `aiTools`, `/plugin` (Textus AI
   writes a plugin), the template repository and `@textus/market` CLI.
4. **1.3.0**.
