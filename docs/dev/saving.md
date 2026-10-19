# How a document is saved

What Textus writes to a Markdown file when you save it, and why most of
the file comes back exactly as it was. The code is in
`src/editor/markdown/source-preserving.ts`; the tab gets the text from
`src/document-view/useDocumentReporting.ts`.

## The rule

A save writes every top-level block you didn't change as it was in the
file, byte for byte, and serializes only the blocks you changed. A file
opened and saved without an edit, or with its edits undone, is unchanged.

The serializer (remark, with the rules in `markdown-output.ts`) has a
house style: `*em*` rather than `_em_`, ATX headings, padded tables,
escapes such as `snake\_case`. Before 1.2.0 a single edit serialized the
whole document, so every block in the file took on that style, and anyone
who also keeps the file in Git, or edits it in another app, saw the whole
file change. Now only the edited block does.

## How it works

1. **Opening.** `openedParseRecorder` wraps the editor's parser for the
   one parse of the text the editor opens with. It reads the file the way
   the stock parser does, and also notes, for each child of the mdast root,
   its offsets in the text (`position`) and the top-level blocks it became.
   No second parse is needed. When the editor has mounted,
   `readSourceBlocks` pairs those blocks with the editor's document. A
   block that doesn't match (a plugin changed it on load, and it no longer
   serializes the same) is never written from the file.
2. **Saving.** `writePreservingSource` walks the editor's top-level blocks.
   ProseMirror keeps a block nobody touched as the same node object through
   every edit elsewhere, so a block that is still that object is written as
   its stretch of the file. A block that isn't, but stands where an
   unclaimed block stood and is equal to it (or serializes the same), is
   written from the file too. Consecutive kept blocks keep the blank lines
   the file had between them. Each run of changed blocks is serialized in
   one go, and joined to its neighbours by one blank line, the serializer's
   separator. The text before the first block and after the last is the
   file's own while those blocks are the file's first and last; otherwise
   the file keeps whether it ended with a newline.
3. **Checking the joins.** A block written as it was can mean something
   else next to a new neighbour: two lists that become adjacent merge, an
   indented code block after a list joins the list, a `---` that becomes
   the first block opens front matter. So every join the file didn't have
   is parsed again, with the document's link and footnote definitions after
   it, and compared with what the editor holds. Where the two sides don't
   come back as they are, the kept blocks beside that join are serialized
   too, and the check runs again. After a few rounds the whole document is
   serialized, as before 1.2.0.

When in doubt, serialize: a block is never written from the file unless it
is the block that was read from there. A noisier diff is better than a file
that reads differently.

Line endings and the byte-order mark are restored after this, by
`src/document/file-format.ts`: the editor works in `\n`, and a CRLF file is
written back as CRLF.

## Reference links and wikilinks

- **Reference links** (`markdown/reference-links.ts`). `[text][ref]`,
  `[ref][]` and `[ref]` are read as links to the URL their definition
  gives, and written back as references while that URL and title are
  unchanged. A definition, `[ref]: url`, is kept as its source text, shown
  quietly like raw HTML. Milkdown's `remarkInlineLinkPlugin`, which inlined
  every reference and deleted the definitions, is left out
  (`reduced-presets.ts`).
- **Wikilinks** (`markdown/wikilink.ts`). Obsidian's `[[Note]]`,
  `[[Note|text]]` and `[[Note#Heading]]` are one node holding their
  source, written back as they were. Ctrl/Cmd+click opens the note:
  `resolve_vault_note` in `src-tauri/src/commands/vault.rs` looks in the
  document's folder, then by name across the vault, as for image embeds.
- **Tags.** A `#` at the start of a line is escaped only where it would
  open a heading (up to six `#` and a space), so `#tag` stays `#tag`.

## What is still rewritten

- A block you edit is serialized whole, in the serializer's style: edit
  one word of a paragraph with `_em_` and the paragraph is saved with
  `*em*`. A list or a table is one block, so an edit in one item rewrites
  the whole list or table.
- The blank lines next to an edited block become one.
- A block beside a join that doesn't read back as it should, as above.
- A document whose blocks don't line up with the file on opening - an
  empty file, which the editor opens as one empty paragraph - is
  serialized whole on every save, as before.

## Performance

Matching the blocks is a pass over the document's top-level nodes; only the
changed runs are serialized, and only the new joins are parsed. A run's text
and a join's check are remembered by the blocks they were about
(`SaveMemo`), so the runs changed earlier aren't worked out again on every
save. On a 5,000-block document (220 KB) in the unit tests' jsdom:

| Step                                                         | Time        |
| ------------------------------------------------------------ | ----------- |
| Pairing the blocks, once after mounting                      | about 60 ms |
| A save after a one-word edit                                 | 3-7 ms      |
| Serializing the whole document (before 1.2.0, on every edit) | 250-300 ms  |
| The first save after 1,000 scattered edits (a Replace All)   | about 1.5 s |
| Each save after that                                         | about 7 ms  |
