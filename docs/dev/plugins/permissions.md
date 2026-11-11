# Permissions

A plugin lists in `permissions` what it needs; the user sees the list when
installing it ("asks to:") and can take any one back on its page in
Settings. A call or event whose permission the plugin lacks fails with
"<id> was not granted <permission>". Calls with no permission (commands,
menus, views, layout, settings, storage, `dates`, `templates`, `env`) need
nothing.

Before install, Textus reads a plugin's code and names a call whose
permission the manifest leaves out; Create mode's `check_plugin` does the
same for a plugin Textus AI wrote. This page and
[api-permissions.ts](../../../src/plugins/api-permissions.ts) are kept in
step by a test.

| Permission       | What it allows                                                         | Calls that need it                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor.read`    | Read the document in front: text, selection, blocks, outline           | `editor.getPath`, `editor.getText`, `editor.getSelection`, `editor.getBlocks`, `editor.getOutline`, `editor.registerHover`, `editor.registerDecorations`, `editor.registerCompletion`, `export.willExport`                                                                                                                             |
| `editor.write`   | Change it at once, each change one undo step                           | `editor.edit`, `editor.insertText`, `editor.replaceSelection`, `codeBlock.setSource`                                                                                                                                                                                                                                                   |
| `editor.propose` | Suggest changes the user accepts or rejects, as Textus AI's            | `editor.propose`                                                                                                                                                                                                                                                                                                                       |
| `editor.input`   | Take the editor's keys and move, select and edit with them             | `editor.captureKeys`, `editor.exec`                                                                                                                                                                                                                                                                                                    |
| `files.read`     | Read the open folder's files and what Textus knows of them             | `files.root`, `files.list`, `files.find`, `files.stat`, `files.read`, `files.readText`, `files.conventions`, `files.appSettings`, `metadata.get`, `metadata.all`, `metadata.backlinks`, `metadata.resolveLink`, `metadata.resolveNote`, `metadata.linkTo`, `metadata.tags`, `metadata.tasks`, `metadata.search`, `views.registerEmbed` |
| `files.write`    | Create, change, rename and trash files there; includes `files.read`    | `files.writeText`, `files.write`, `files.create`, `files.process`, `files.rename`, `files.trash`, `files.createFolder`, `files.frontmatter.update`, `files.blockId`, `files.onWillSave`, `webview.writeFile`                                                                                                                           |
| `project.data`   | Keep its own data in the folder, in `.textus/plugins/<id>/`            | `storage.project`                                                                                                                                                                                                                                                                                                                      |
| `clipboard`      | Read and write the clipboard                                           | `clipboard.readText`, `clipboard.writeText`, `env.readClipboard`, `env.writeClipboard`                                                                                                                                                                                                                                                 |
| `notifications`  | Show system notifications                                              | `notify.show`, a job's `notify`                                                                                                                                                                                                                                                                                                        |
| `ai.tools`       | Give Textus AI tools to call                                           | `ai.registerTool`                                                                                                                                                                                                                                                                                                                      |
| `background`     | Run its `background` code on a schedule, also with every window closed | the manifest's `background` file, a job's `run`                                                                                                                                                                                                                                                                                        |
| `agents`         | Run the AI agents it names in `contributes.agents`                     | Textus AI's model menu offering them; Textus starts each one itself                                                                                                                                                                                                                                                                    |
| `network:<host>` | HTTPS requests to that host (`network:*` for a host the user enters)   | `net.fetch`                                                                                                                                                                                                                                                                                                                            |
| `commands:<id>`  | Run the commands another plugin lists in its manifest                  | `commands.execute` with that plugin's command                                                                                                                                                                                                                                                                                          |

## Events

Subscribing to an event without its permission throws, and the plugin's
log says so; nothing else does.

| Needs          | Events                                                                                                                                                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files.read`   | `files.onDidSave`, `files.onDidChangeRoot`, `files.onDidChangeConventions`, `files.onDidCreate`, `files.onDidChange`, `files.onDidRename`, `files.onDidDelete`, `metadata.onDidChange`                                                                                                          |
| `editor.read`  | `editor.onDidChangeActive`, `editor.onDidChange`, `editor.onDidChangeSelection`                                                                                                                                                                                                                 |
| `editor.input` | `editor.keys.onKey`                                                                                                                                                                                                                                                                             |
| `clipboard`    | `env.onDidCopy`                                                                                                                                                                                                                                                                                 |
| nothing        | `layout.onDidChangeActiveTab`, `layout.onDidChangeLayout`, `layout.onDidChangePanels`, `layout.onDidChangeFloating`, `layout.onDidTouchFloating`, `env.onDidChangeTheme`, `env.onDidChangeLanguage`, `settings.onDidChange`, `app.onDidChangeState`, `app.onDidActivity`, `ai.onDidChangeState` |

## Silent ones

- A completion (`editor.registerCompletion`) without `editor.read` is left
  out with no error.
- A webview's `textus-resource:` files are the plugin's own; a page reaches
  nothing else and has no network.
