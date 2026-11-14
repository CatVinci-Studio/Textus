# Versions

Which Textus each part of the plugin API needs. Set `engines.textus` to
the newest one you use (`">=1.3.10"`); Textus outside the range doesn't
load the plugin. To use something newer only where it exists, check it
instead: `if (textus.dates) …`, or compare `textus.env.apiVersion` as
numbers ("1.10" is after "1.9").

| API | Textus       | Added                                                                                                                                                                 |
| --- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.6 | 1.4.2        | `export.mathCss`, KaTeX's stylesheet with its fonts inline; `appearance` (permission `appearance`): a palette over the theme, the frame's paint a gradient            |
| 1.5 | 1.3.13-rc.1  | `contributes.agents` and the `agents` permission, AI agents on the computer in Textus AI's model menu; `layout.openSettings`                                          |
| 1.4 | 1.3.10       | `dates`, `templates`, `files.appSettings`, `layout.panels` / `onDidChangePanels`; conventions' `weekly`, `monthly`, `templateFormats`; `files.write` includes reading |
| 1.3 | 1.3.10-rc.1  | `env.onDidCopy`, `layout.showSidebarTab`, a list's `onMove`                                                                                                           |
| 1.2 | 1.3.9        | `files.conventions`, `metadata.resolveNote`, `metadata.linkTo`, completions' new fields, `keys.capture`'s answer, `onWillSave`'s blocks, `offerPlugin`                |
| 1.1 | 1.3.0-beta.8 | `schedule`, `notify`, `app`, change sources                                                                                                                           |
| 1.0 | 1.3.0-beta.2 | The first API                                                                                                                                                         |

Each call's own "From …" note in [textus.d.ts](../textus.d.ts) is the
exact version; [the reference](reference.md) shows them too.
