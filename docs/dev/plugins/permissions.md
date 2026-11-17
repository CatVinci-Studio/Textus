# Permissions

A plugin lists in `permissions` what it needs; the user sees the list when
installing it ("asks to:") and can take any one back on its page in
Settings. A call or event whose permission the plugin lacks fails with
"<id> was not granted <permission>". Commands, menus, views, layout, settings,
`ctx.storage.global`, `dates`, `templates`, `text`, `env` (but its
clipboard), `export.mathCss`, `appearance.colors` and `plugins.get` need
none.

Before install, Textus reads a plugin's code and names a call whose
permission the manifest leaves out; Create mode's `check_plugin` does the
same for a plugin Textus AI wrote. The table it reads is
[api-permissions.ts](../../../src/plugins/api-permissions.ts); a test
checks this page names every permission there.

| Permission       | What it allows                                                                                        | Calls that need it                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor.read`    | Read the document in front: text, selection, blocks, outline                                          | `editor.getPath`, `editor.getText`, `editor.getSelection`, `editor.getBlocks`, `editor.getOutline`, `editor.registerHover`, `editor.registerDecorations`, `editor.registerOutline`, `editor.registerCompletion`, `export.onWillExport`                |
| `editor.write`   | Change it at once, each change one undo step                                                          | `editor.edit`, `editor.insertText`, `editor.replaceSelection`, `editor.registerPasteHandler`, a code block's `block.setSource`                                                                                                                        |
| `editor.propose` | Suggest changes the user accepts or rejects, as Textus AI's                                           | `editor.propose`                                                                                                                                                                                                                                      |
| `editor.input`   | Take the editor's keys and move, select and edit with them                                            | `editor.keys.capture`, `editor.keys.exec`                                                                                                                                                                                                             |
| `files.read`     | Read the open folder's files and what Textus knows of them                                            | `files.root`, `files.list`, `files.find`, `files.stat`, `files.read`, `files.readText`, `files.conventions`, `files.appSettings`, `files.setBadge`, `files.frontmatter.get`, `metadata.*`, `git.status`, `git.log`, `git.show`, `views.registerEmbed` |
| `files.write`    | Create, change, rename and trash files there; includes `files.read`                                   | `files.writeText`, `files.write`, `files.create`, `files.process`, `files.rename`, `files.trash`, `files.createFolder`, `files.frontmatter.update`, `files.blockId`, `files.setConvention`, `files.onWillSave`, a file editor's `file.writeText`      |
| `project.data`   | Keep its own data in the folder, in `.textus/plugins/<id>/`                                           | `storage.project`                                                                                                                                                                                                                                     |
| `clipboard`      | Read and write the clipboard                                                                          | `env.readClipboard`, `env.writeClipboard`                                                                                                                                                                                                             |
| `notifications`  | Show system notifications                                                                             | `notify.show`, a job's `notify` (one that opens a document also needs `files.read`)                                                                                                                                                                   |
| `ai.tools`       | Give Textus AI tools to call                                                                          | `ai.registerTool`                                                                                                                                                                                                                                     |
| `ai.model`       | Ask the user's writing model; the first call asks the user, 100,000 tokens a month (API 1.8, preview) | `ai.available`, `ai.complete`                                                                                                                                                                                                                         |
| `comments`       | Read and leave notes in a document's margin, with files.read for the file (API 1.8, preview)          | `comments.list`, `comments.add`, `comments.resolve`, `comments.onDidChange`                                                                                                                                                                           |
| `background`     | Run its `background` code on a schedule, also with every window closed                                | the manifest's `background` file, a job's `run`                                                                                                                                                                                                       |
| `agents`         | Run the AI agents it names in `contributes.agents`                                                    | Textus AI's model menu offering them; Textus starts each one itself                                                                                                                                                                                   |
| `appearance`     | Change Textus's colours (1.6)                                                                         | `appearance.setColors`: a palette over the theme until disposed or the plugin is turned off                                                                                                                                                           |
| `git.commit`     | Commit files of the open folder with the user's git (1.4.3)                                           | `git.commit`: those files' changes only, through the user's hooks and signing                                                                                                                                                                         |
| `network:<host>` | HTTPS requests to that host (`network:*` for a host the user enters)                                  | `net.fetch`                                                                                                                                                                                                                                           |
| `commands:<id>`  | Run the commands another plugin lists in its manifest                                                 | `commands.execute` with that plugin's command                                                                                                                                                                                                         |

## Events

An event subscribed to without its permission never fires; the plugin's
log says why.

| Needs          | Events                                                                                                                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files.read`   | `files.onDidSave`, `files.onDidChangeRoot`, `files.onDidChangeConventions`, `files.onDidCreate`, `files.onDidChange`, `files.onDidRename`, `files.onDidDelete`, `metadata.onDidChange`                                                                                                                                    |
| `editor.read`  | `editor.onDidChangeActive`, `editor.onDidChange`, `editor.onDidChangeSelection`, `editor.onDidChangeVisible`                                                                                                                                                                                                              |
| `editor.input` | `editor.keys.onDidPressKey` (`onKey`)                                                                                                                                                                                                                                                                                     |
| `clipboard`    | `env.onDidCopy`                                                                                                                                                                                                                                                                                                           |
| nothing        | `layout.onDidChangeActiveTab`, `layout.onDidChangeLayout`, `layout.onDidChangePanels`, `layout.onDidChangeFloating`, `layout.onDidTouchFloating`, `env.onDidChangeTheme`, `env.onDidChangeLanguage`, `settings.onDidChange`, `app.onDidChangeState`, `app.onDidActivity`, `ai.onDidChangeState`, `appearance.onDidChange` |

## Silent ones

- These do nothing without their permission, with no error: a completion
  (`editor.registerCompletion`), `editor.registerHover`,
  `registerDecorations`, `registerOutline`, `registerPasteHandler`,
  `views.registerEmbed`, `files.onWillSave`, `export.onWillExport`. The
  install check names the permission they need.
- A webview's `textus-resource:` files are the plugin's own; from the
  network a page shows only pictures and frames of the hosts its plugin's
  `network:` permissions name.
