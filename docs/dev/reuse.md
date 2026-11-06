# What to reuse

Before writing a helper, a component or a style, look here: each need below
has one place in the code, and a second copy is a review comment
(`scripts/check-duplicates.mjs` catches the long ones). If what you need is
missing, add it to that place, not beside your feature.

## Surfaces and controls

Where a surface sits, when it comes and goes and what it may hold is the
surfaces table in [design-language.md](../design/design-language.md) (5.5).
The pieces:

| Need                                       | Use                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| A button that is only an icon              | `ui/IconButton.tsx` (named, with the app's Tooltip)                                                                  |
| A menu at the pointer, or under a button   | `ui/ContextMenu.tsx`; `ui/useMenuButton.tsx` hangs it from a button (end-aligned, with a heading)                    |
| A box that floats over the page            | the `.floating-surface` class; layers from the `--z-*` tokens (`ui/motion.css`)                                      |
| Closing it on a press outside or Escape    | `utils/hooks/useCloseOnOutsideClick.ts` (input methods spared; `inside` for a badge or the opener)                   |
| Placing it next to what opened it          | `ui/placement.ts` (`clampLeft`, `opensBelow`), or `useViewportClamp` for a point                                     |
| A dialog                                   | `ui/app-dialog.tsx` (`showMessage`, `showConfirm`, `showPrompt`); a dialog of your own takes the `.close-prompt` box |
| A list to pick from                        | `showQuickPick` (`ui/quick-pick.tsx`)                                                                                |
| A note that goes by itself, a progress bar | `showNotice`, `startProgress` (`ui/notices.tsx`)                                                                     |
| A card to act on, bottom right             | `ui/CornerToast.tsx` in a `CornerStack`                                                                              |
| A phone's sheet                            | `ui/Sheet.tsx` (`ActionSheet` and `BottomCard` are its bodies)                                                       |
| A select, a switch, a settings row         | `ui/Select.tsx`; `settings/sections/controls.tsx`                                                                    |

## Text, links and folders

| Need                                                     | Use                                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Filtering a list as the user types (pinyin too)          | `utils/list-filter.ts` (`prepareList`, `rankList`)                                                             |
| Folding case and accents                                 | `utils/search-fold.ts`; pinyin `utils/pinyin.ts`                                                               |
| Paths: `/`-separated, a note file, a URL or a drive path | `utils/path.ts` (`slashed`, `isNoteFile`, `noteStem`, `hasUrlScheme`, `isDrivePath`, `relativePath`)           |
| Reading a `[[link]]`                                     | `utils/note-link.ts` (`parseNoteLink`; `WIKILINK_SOURCE` to find them in text)                                 |
| Where a link goes, as a click takes it                   | `links/link-resolve.ts` (and Rust `resolve_note_link`, which shares its cases)                                 |
| Writing a link the way the folder does                   | `links/link-style.ts`, `links/link-resolve.ts` `linkToTarget`; Markdown links `editor/markdown/link-syntax.ts` |
| A `#heading` or `^block` inside a note                   | `editor/markdown/link-target.ts` `headingIndex`, `editor/markdown/heading-jump.ts`                             |
| Scrolling to a place in the document                     | `revealPosition` (`editor/reveal-position.ts`); a tab not yet shown takes a `setTabJump`                       |
| Rewriting links when a note moves                        | `links/link-rewrite.ts`                                                                                        |
| Front matter                                             | `utils/frontmatter.ts`                                                                                         |
| `\|` in a table cell                                     | `editor/tables/cell-pipes.ts`                                                                                  |
| How the folder is written, whichever app made it         | `conventions` (Rust `src-tauri/src/conventions/`, `fs.folderConventions`; plugins `files.conventions`)         |

## Textus AI

How a request runs is [ai-agent.md](../design/ai-agent.md); how a proposed
edit becomes decided sentences is [ai-proposals.md](../design/ai-proposals.md).
To build on it:

| Need                                       | Use                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Asking Textus AI from anywhere in the app  | `askAi(text, mode)` (`ai/chat/ask-ai.ts`)                                                          |
| A conversation on a surface                | `ai/chat/ChatBody.tsx` (messages and composer, shared by the panel, Quick Ask and the chat window) |
| A proposed edit shown, decided and applied | `ai/revision/` (its editor plugin and the review bar); never write the document directly           |
| Notes beside the text                      | `ai/margin/`                                                                                       |
| Blocks as the model sees them (`[#id]`)    | `ai/doc-blocks.ts`, `ai/doc-markdown.ts`                                                           |
| Streaming text in                          | `ai/stream-reveal.ts`                                                                              |
| Sources as footnotes                       | `ai/citations.ts`                                                                                  |
| A provider and its models                  | `ai/provider-catalog.ts`, Rust `crates/aicompat` (no Tauri inside)                                 |
| From a plugin                              | `textus.ai.registerTool` (a tool the AI may call), `ai.state()` / `ai.onDidChangeState`            |
