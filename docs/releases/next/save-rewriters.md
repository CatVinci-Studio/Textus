### Fixed

- Plugins that tidy a document as it is saved (Markdown Lint, CJK Spacing, Text Tidy) now run in a fixed order, change only the blocks they mean to, and never touch code, math, HTML or link definitions; each line keeps its Windows or Unix line ending, and two plugins that would undo each other's change on every save are stopped instead of fighting.

### Platform notes

- Plugin API: `onWillSave` gets the document's `blocks` (with their offsets) and the save's `trigger`, and may return just the blocks it changed; `onWillSave` and `onWillExport` plugins run in plugin id order.
