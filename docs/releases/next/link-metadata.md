### Fixed

- Backlinks, the graph and other plugins find a link where a click goes: a table's `[[Note\|alias]]` counts, `[[Note v1.2]]` and `[t](Note)` find their note, and two notes of one name are told apart the same way everywhere.
- Plugins see front matter `tags:` as tags, no longer take a link's `(#anchor)` for a tag, and leave out links and tags inside `%%comments%%`; tasks marked `- [/]` and the like count as done, as in Obsidian.

### New

- Plugins can ask where a link goes, block and heading line included (`metadata.resolveNote`), and see each note's block ids and front matter aliases.
