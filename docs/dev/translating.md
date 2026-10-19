# Translating the app

The app's UI comes in ten languages. Every one of them is already registered
everywhere it has to be - the language pickers, `<html lang>` and the font
stacks, the macOS menu bar, the Windows installer, the iOS bundle - and a
language without a translation shows English. So translating a language
means filling in **the files that belong to it, and nothing else**: no
shared file changes, which is what lets each language be done on its own,
in parallel with the others.

| Code      | Language                                             |
| --------- | ---------------------------------------------------- |
| `en`      | English - the source every other language translates |
| `zh`      | Simplified Chinese (the code stays `zh`)             |
| `zh-Hant` | Traditional Chinese, as written in Taiwan            |
| `ja`      | Japanese                                             |
| `ko`      | Korean                                               |
| `es`      | Spanish                                              |
| `fr`      | French                                               |
| `de`      | German                                               |
| `ru`      | Russian                                              |
| `pt`      | Portuguese, written the Brazilian way                |

`zh` and `ja` are complete and are the best reference for how a finished
language looks.

## The files of one language

For a language `{code}`:

| File                                         | What it holds                                                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/i18n/locales/{code}.ts`                 | The UI's strings: any of `en.ts`'s keys, translated. Exists already, empty. Set `complete = true` once every key is there.                                                                  |
| `src/help/markdown-guide.{code}.md`          | The Markdown guide (Help > Markdown Guide, Settings > General). New file: translate `markdown-guide.en.md`.                                                                                 |
| `src/help/agent-guide.{code}.md`             | The AI features guide (Help > AI Features Guide). New file: translate `agent-guide.en.md`.                                                                                                  |
| `src-tauri/src/ai/ui-names/{code}.txt`       | What the AI is told your UI calls things, so its answers point at labels that exist. Exists already, comment only. One line per line of `en.txt`: `English name = yours`.                   |
| `src-tauri/src/ai/style-headings/{code}.txt` | The headings "Learn my style" gives a style profile written in your language. Exists already, comment only. One line: title and seven sections, separated by `/`.                           |
| `src-tauri/src/ai/rules/messages/{code}.txt` | What the grammar check and the conventions check say when a rule for every language fires on text in your language (a space before a comma, a doubled word). One line per line of `en.txt`. |
| `src/i18n/skills/{code}.ts`                  | The built-in skills' names in the `/` menu and Settings: a label, a one-line hint and the aliases people type after `/`, for each of the eighteen. Every skill is required.                 |

Anything a file leaves out falls back to English, so a half-done language
still works - but only a language whose seven files are all filled in is
done. The app finds the guides by their file names; nothing has to be
registered.

Do not edit `src/i18n/langs.ts`, `strings.ts`, `names.ts`, another
language's files, or code. If a string can't be translated well without a
code change (a word order the code fixes, a missing plural), say so instead.

### `locales/{code}.ts`

Start from `zh.ts` or `ja.ts` for the shape, and from `en.ts` for the text:

```ts
import { AI_NAME, APP_NAME } from "../names";
import type { Translation } from "../strings";

/** German. */
export const complete = true;

export default {
  agentPanelTitle: AI_NAME,
  agentPanelToggle: "KI-Bereich",
  // ...
} satisfies Translation;
```

- **The app's and the AI's names come from `names.ts`**, never written out:
  `` `Willkommen bei ${APP_NAME}` ``, `` `Einstellungen > ${AI_NAME}` `` -
  use a template literal wherever `en.ts` does, so a rename happens in
  one place. (The terminal command `textus` and the `.textus`
  folder are file names, not the product's name: keep them as they are.)
- **Count strings are plural forms**, an object with one entry per plural
  category of your language, each saying `{n}`:

  | Language                      | Categories                    |
  | ----------------------------- | ----------------------------- |
  | `zh-Hant`, `ja`, `ko`, (`zh`) | `other`                       |
  | `de`, (`en`)                  | `one`, `other`                |
  | `es`, `fr`, `pt`              | `one`, `many`, `other`        |
  | `ru`                          | `one`, `few`, `many`, `other` |

  `many` in Spanish, French and Portuguese is for round millions ("1 000 000
  de documents"); it is usually the same as `other`.

- **Placeholders** - `{n}`, `{name}`, `{path}`, `{arg}`, `{shortcut}`,
  `{action}`, `{date}`, `{i}`, `{k}`, `{query}`, `{total}` - stay exactly
  as they are, each one
  kept and none added; move them wherever the sentence needs them.
- **The starter files** (`agentInstructionsTemplate`,
  `projectInstructionsTemplate`, `projectStyleTemplate`,
  `projectLibraryTemplate`) become files in the user's project and are sent
  to the AI. Only what is inside `<!-- -->` comments is never sent, so the
  how-to stays inside the comments and nothing else is added. In the
  library entry, the front matter (`name:`, `aliases:`, `include:`,
  `detected | always | never`) is read by code: translate only the comment.
  `projectStyleTemplate`'s headings must be among your
  `style-headings/{code}.txt`, and it names the menu item
  `projectLearnStyle` exactly; `agentInstructionsTemplate` names
  `projectEditInstructions` exactly. Every starter mentions `${AI_NAME}`.
- **Settings paths** read `<settingsTitle> > <page>`, with your translations
  of `settingsTitle` and of the page's `nav*` label exactly (for example
  `Einstellungen > ${AI_NAME}`).
- `projectPickFolder` contains `agentWorkspaceRootLabel` (the same words,
  in any case): the menu item and the Settings row it matches.
- Menu items keep their `…` where English has one (the item asks for more
  before it acts). `menuAbout`, `menuHide` and `menuQuit` say `{name}`
  where the app's name goes in the macOS menu.
- Name controls the way your own translation names them: a string that says
  "click Accept" says your `proposalAccept`.

### `skills/{code}.ts`

The built-in skills keep English names (`/proofread`, `/continue-story`),
which never change; this file is what your users see and type instead.
Start from `zh.ts` or `ja.ts`:

- `label`: what the skill does, as a short command or noun phrase, about
  24 characters at most - it is the `/` menu's row and the Settings row.
- `hint`: one line on what it does, without a final full stop, in the
  same register as your other Settings text (the `de` hints say `du`).
- `aliases`: the words people would type after `/` for it, besides the
  label - a shorter form, a synonym, the everyday name of the genre
  (`/公文`, `/校正`, `/요약`). No spaces where a typed word can't have
  one; each alias names one skill only, in every language
  (`skills.test.ts` checks).
- Never use your UI's word for inline completion as a label (续写,
  續寫, 補完, 이어 쓰기, autocompletado, complétion, Vervollständigung,
  автодополнение, autocompletar): that word already names the editor
  feature. It may be an alias.
- Name concepts as your strings do (the library, the style profile).

### The tutorial

The first-run tour is a short card per lesson: a title, one sentence, and
the things to do, one line each. Keep them that short in your language.

- Each `...Body` is one sentence; every task line (the lesson's other keys)
  one line, without a final full stop. Text in backticks is what the
  learner types, shown as code; to show backticks inside it, open and close
  with two (``` `` `Act I` `` ```), as in Markdown. `{title}` is the
  practice notes' title, `{slip}` their grammar lesson's sentence,
  `{shortcut}` a keyboard shortcut, `{path}` where in Settings an AI is
  connected.
- The practice notes (`src/onboarding/practice-notes.ts`, one entry per
  language) quote the classic the website shows for your language
  (`site/content/classics/<code>.json` in the website repository) and add
  the reader's own notes. The lines the learner types (characters, a
  quote, the prompts to the AI) come from the same work. The AI lessons
  only ever change the notes, never the quoted text.
- Name controls as your strings do: the menu path (`menuView` ›
  `menuToggleSidebar`), `outlineTab`, `proposalAccept`, `proposalReject`,
  `grammarApply`, `agentTabMemory`.
- Lesson titles follow the website's names for the features
  (`site/i18n/<code>.mjs` in the
  [website repository](https://github.com/CatVinci-Studio/levis-homepage/tree/main/site/i18n),
  its `writing` and `ai` sections).
- `tutorialSkillsTask` names two built-in skills as the learner would type
  them, `/word` in backticks: a label or alias of `tighten` and of
  `translate` in your language (`src/ai/skills/texts/<code>.ts`) without a
  space in it.

`src/onboarding/tutorial-copy.test.ts` checks these: one sentence per body,
one line per task, code spans that close, the controls' names, and that
each `/word` runs the skill it should.

### The help guides

Translate the whole guide. Keep every heading, at the same level and in the
same order (the test compares the outline with English's), the code blocks,
the Markdown samples (`#`, `**`, `$...$`, the Mermaid diagrams) and the
links. The product's and the AI's names are written out here, as in the
English guide. Name every control exactly as your `locales/{code}.ts` does;
the AI is told to send users to these names.

### `rules/messages/`

`messages/{code}.txt`: every `key = message` line of `en.txt`, translated,
keeping each `{0}`, `{1}` (a word or a number the code fills in). They are
shown in the editor next to the text they are about, so write them as your
language's style guides would: short, in your punctuation (full-width in
Chinese and Japanese, « » with spaces in French). A test checks that every
file has every key and the same placeholders. Rules for one language only
carry their messages in that language, in the code; they are not
translated.

### `ui-names/` and `style-headings/`

`ui-names/{code}.txt`: copy `en.txt`'s lines, in order, and add
` = <the name in your UI>` to each. A label in the list is your translation
of that label in `locales/{code}.ts`, character for character; a concept
("project menu", "library", "completion") is the word your strings and your
`agent-guide.{code}.md` use for it. The note in parentheses on the English
side ("Style (the chip)") stays as it is. Leave the file comment-only if you
can't fill all of it: the AI then names everything in English.

`style-headings/{code}.txt`: one line, `Title / Section / ... / Section`,
for the eight headings English has (Style profile, Voice and tone,
Sentences and rhythm, Word choice, Punctuation and formatting, Structure,
Never, Examples), without `#`. The headings of your `projectStyleTemplate`
are among them, spelled the same.

## Tone

The English is plain, short and calm, and every translation should read the
same way: written for the user, never about the software; no exclamation
marks, no "please" in labels, no marketing words. Some rules for all
languages:

- A label is as short as it can be and still clear. Aim for no more than
  about 1.4 times the English length in buttons, menus, tabs and Settings
  rows; long languages wrap, but every wrap costs.
- Use the words your platform already uses in your language for the
  standard commands and places: Undo, Copy, Paste, Select All, Settings,
  Minimize, Zoom, Full Screen, the Finder/Files app, the Dock. Follow
  Apple's terms in the macOS and iOS UI where they differ from Windows'.
- Keep product and technology names as they are: Markdown, KaTeX, Mermaid,
  Pandoc, OpenAI, Anthropic, Claude, ChatGPT, Gemini, the file formats.
- Use your language's own punctuation and quotation marks: full-width
  `，。：；？！（）` and `「」` in Chinese and Japanese, `« »` with
  non-breaking spaces in French (and a non-breaking space before `: ; ? !`),
  `„…“` in German, `«…»` in Russian.
- Address the user one way throughout: `你` (as `zh` does) in Traditional
  Chinese, with Taiwan's vocabulary (檔案, 資料夾, 設定, 軟體, 預設); the
  polite です/ます style as `ja` does; 합니다/하세요 in Korean; `tú` in
  Spanish, neutral rather than regional; `vous` in French; `du` in German;
  `вы` (lower case) in Russian; `você` in Portuguese.
- Translate meaning, not words: a sentence that reads like a translation is
  wrong even when every word is right.

## Checking a translation

```sh
npm test            # every language: keys, placeholders, plurals, tutorial, guides
npm run check       # the same plus types, lint and formatting
cd src-tauri && cargo test   # ai-names and style-headings against your strings and guide
```

`src/ai/skills/texts/skills.test.ts` checks the skill labels, hints and
aliases. `src/i18n/strings.test.ts` fails on a key English doesn't have, a value of
the wrong kind, an empty string, a placeholder kept or added wrongly, a
missing or unknown plural form, or - once `complete = true` - any key not
translated. The tests in
`src/help/help-guides.test.ts` compare your guides' outline with
English's, and `src/i18n/ai-concepts.test.ts` checks the starter files and
the Settings paths. In `src-tauri`, `agent.rs`'s
`the_prompt_names_things_exactly_as_the_ui_does` checks every line of your
`ui-names` file against your strings and guide, and `project.rs`'s
`learned_profiles_use_the_template_headings` your style headings.

Then look at it: `npm run tauri dev` (or `npm run dev` for the app in a
browser), pick the language in Settings > General, and
go through Settings (on a narrow window too), the AI panel, Quick Ask, the
tutorial (Help > Welcome and Tutorial) and both guides. Nothing should be
cut off, overlap, or push a button out of view.
