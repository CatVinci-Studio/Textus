# Plugin documentation

Everything for writing a Textus plugin, in the order you need it:

| Page                             | For                                                                   |
| -------------------------------- | --------------------------------------------------------------------- |
| [guide.md](guide.md)             | Start here: a plugin in five minutes, the manifest, and the API by area |
| [pages.md](pages.md)             | Webviews: Textus's controls and styles, menus, dragging, floating views |
| [permissions.md](permissions.md) | What each permission allows, and which calls and events need which     |
| [versions.md](versions.md)       | Which Textus each part of the API needs                                |
| [testing.md](testing.md)         | Checking a plugin while you write it, unit tests, end-to-end tests     |
| [publishing.md](publishing.md)   | Versions, the README and pictures, your repository, the store          |
| [reference.md](reference.md)     | Every call and type, made from [textus.d.ts](../textus.d.ts)           |
| [skill/](skill/SKILL.md)         | The same API as a skill an AI coding assistant can load                |

The manifest's schema is [textus-plugin.schema.json](../textus-plugin.schema.json);
how the plugin system works inside the app is [plugin-api.md](../plugin-api.md).
