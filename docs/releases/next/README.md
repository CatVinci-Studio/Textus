# Release-note fragments

A pull request with a change users will notice adds its release note here,
in a file of its own, instead of editing `docs/releases/X.Y.Z.md`: two pull
requests then never touch the same lines, and the second to merge needs no
rebase. Name the file after your branch or change, such as
`pdf-page-numbers.md`.

A fragment has one or more of the template's section headings - `### New`,
`### Improved`, `### Fixed`, `### Platform notes` - each with its bullets,
written as [TEMPLATE.md](../TEMPLATE.md) and CONTRIBUTING.md › Writing say:

```md
### Fixed

- Keeps the caret where it was when you switch tabs, instead of moving it to the top of the document. (#123)
```

`npm run check` checks the format. At release time
`node scripts/release-notes.mjs build X.Y.Z` adds every fragment to
`docs/releases/X.Y.Z.md`, oldest first, and deletes the fragments
([releasing.md](../../dev/releasing.md)).
