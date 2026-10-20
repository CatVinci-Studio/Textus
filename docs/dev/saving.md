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
   serializes the same) is never written from the file. A block's stretch
   starts at the beginning of its first line, so its indent goes with it
   (` -    one` and the indented code under it stay a list and code), and
   never inside the stretch before it: a setext heading under a
   definition, `[foo]: /url\nbar\n===`, starts where the definition does.
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
   it, and compared with what the editor holds. A run of empty paragraphs
   writes nothing, so the blocks on either side of it are the ones that
   meet there. Where the two sides don't
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

## The round-trip test

A save that writes the wrong thing destroys someone's file, so saving is
tested on real documents, in the same editor the app runs: the full
extension chain (`createTestEditor`), the real parse, ProseMirror document
and serializer, and the save the tab makes (`useDocumentReporting.ts`).
The harness is `src/document-view/save-roundtrip.ts`. For each file it:

- opens it and saves it without an edit: the output must be the file, byte
  for byte;
- makes one edit of each kind, each on a fresh load: types a word into a
  paragraph, deletes a word, makes a word bold (`toggleSpan`, as the
  toolbar does), adds a list item (Enter at the end of an item), types into
  a table cell, inserts a heading between two blocks, pastes Markdown text
  at the end of a paragraph (through the editor's paste handling),
  replaces a whole paragraph with new Markdown as an AI edit does, and
  types a word then undoes it (the save must then be the file, byte for
  byte). Each edit is
  picked by a generator seeded from the file's name, so a failure names
  the file, the edit and the seed that reproduce it.

After each edit it checks that:

- every top-level block the edit didn't touch is in the output as the file
  had it, byte for byte, in order (a kept block right beside the edit may
  be serialized by the join check above, and is then checked by the next
  point);
- the output, read again, holds the editor's text: the same text in every
  textblock, the same link targets, images and footnote references, and
  the same top-level blocks;
- nothing threw.

The text comparison leaves out only what Markdown can't hold or writes
differently and reads the same: spaces at the ends of a line of prose, line
ends (shown as spaces) more than one at a time or at a paragraph's end, a
hard break at a paragraph's end, empty paragraphs, spaces at a link's
edges, a line end in inline code, and the space written between two
formulas left side by side (`contentText` lists them). A failure that
the whole-document serializer shares is reported as the serializer's
(`-serializer`); the rest are the preservation's.

### Running it

```sh
npx vitest run src/document-view/save-roundtrip           # CI's subset, under a minute
node scripts/roundtrip-corpus/fetch.mjs                   # download the corpus, once
npm run test:roundtrip                                     # the whole corpus, about 2 minutes
npm run test:roundtrip -- --rounds 3                       # each edit kind three times per file
```

The subset is part of `npm run check`: every construct in
`save-roundtrip-snippets.ts` alone, the shapes the corpus run found bugs
in and 250 documents mixed from the constructs (`save-roundtrip.test.ts`),
and this repository's own `docs/` and `src/help/`
(`save-roundtrip-docs.test.ts`, `save-roundtrip-help.test.ts`), three
files so they run in parallel. All of it is ours, so it is committed.

The corpus is not: it is about 3,700 files, downloaded into
`.cache/roundtrip-corpus/` (gitignored), and only read as text. The
sources, with their licences, are in `scripts/roundtrip-corpus/fetch.mjs`:
the Rust book and Rust by Example (MIT or Apache-2.0), MDN's JavaScript and
CSS pages (CC-BY-SA-2.5), tldr pages in English and Chinese (CC-BY-4.0),
awesome lists (CC0-1.0, CC-BY-4.0), free-programming-books (CC-BY-4.0),
Chinese technical writing (es6tutorial, CC-BY-NC-4.0; docsify's Chinese
docs, MIT), d2l-zh's maths-heavy textbook (Apache-2.0), Pandoc's manual and
test files (GPL-2.0-or-later), an Obsidian vault (kepano, MIT), every
example of the CommonMark and GFM specs (CC-BY-SA-4.0), and thirty popular
READMEs. `npm run test:roundtrip` prints the failures by kind with the
first few of each, how many blocks the serializer alone would write
differently from the file (for information: what an edited block turns
into), and writes `.cache/roundtrip-corpus/report/summary.json`.

### What a save can't keep

The corpus run is clean apart from these, listed in
`save-roundtrip-corpus.test.ts` by file and edit. Each is Markdown having
no way to write what the editor holds, or a reading the parser makes:

- An HTML block that is never closed, such as `<style>` without
  `</style>`, runs to the end of the file in CommonMark: a block added
  after it is read as part of it.
- `* 2. foo` as the first line of a new item is read as text: micromark
  doesn't let a list that starts at 2 begin there.
- Emphasis directly inside emphasis of its kind, `*(*foo*)*` once edited,
  or bold ending in italic, `**a *b***`, with text pasted right after it:
  the serializer writes the same delimiters, which then don't open or
  close. (Bold that starts or ends with punctuation right against a word,
  `foo**(bar)**`, is written with that word's letter as a character
  reference, `fo&#x6F;**(bar)**`, except next to CJK text.)
- A table whose rows have different numbers of cells is filled out with
  empty cells the first time you type in it (the table editing plugin
  does this), and undoing the typing keeps them, so that save isn't the
  file byte for byte.
- Text pasted or typed onto the last line of an HTML block is part of
  the block: CommonMark ends it only at a blank line.
- Deleting or rewriting a reference definition, `[ref]: url`, leaves the
  references to it, `[text][ref]`, as plain text on reopening; the editor
  still shows them as links until then.
- A bare GFM link followed by a character it may take as part of itself:
  `www.x.org/a<b` or `a@b.c_` once edited.

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
