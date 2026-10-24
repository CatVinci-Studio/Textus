### New

- Plugins keep their own data in two places: one for every document, in Textus's config folder beside your global agent.md, and one that travels with a project, in its `.textus/plugins/` - the second only for a plugin you allowed to, as its permissions say. A plugin reaches only its own, each holds up to 50 MB, and a plugin writing one thing no longer rewrites everything it keeps. Plugins use them through `textus.storage.global` and `textus.storage.project`.
