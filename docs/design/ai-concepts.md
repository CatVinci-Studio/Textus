# AI concepts

The names Textus uses for the things that shape Textus AI: what each one is,
where it lives, how the user makes it and what the AI does with it. Every
place that names one of them - the Settings page, the AI panel's project
bar, the help guides (`src/help/agent-guide.*.md`), the READMEs, the prompts
the model sees and the code comments - uses these names and definitions.
Change a concept here first, then everywhere else.

The AI itself is `AI_NAME` in `src/i18n/names.ts` ("Textus AI"); the help guides spell the name out.

"Conversation" below means the AI panel and Quick Ask, which run the same
agent (`src-tauri/src/ai/agent.rs`). "Completion" is the grey continuation.
Grammar check uses only the writing conventions and the library's names.

## Glossary

| Concept              | 中文               | 日本語                   | In one sentence                                                                        |
| -------------------- | ------------------ | ------------------------ | -------------------------------------------------------------------------------------- |
| Project folder       | 项目文件夹         | プロジェクトフォルダー   | The folder Textus AI works in and may read.                                            |
| `.textus/` folder    | `.textus/` 文件夹  | `.textus/` フォルダー    | The project's own settings, inside the project folder.                                 |
| Style profile        | 文风档案           | 文体プロファイル         | How you write, so continuations and edits sound like you.                              |
| Learn my style       | 学习我的文风       | 文体を学習               | Drafts the style profile from samples of your writing.                                 |
| Library              | 资料库             | ライブラリ               | Facts about people, places and terms that must stay consistent.                        |
| Writing instructions | 写作要求           | 執筆の指示               | Standing rules sent with every conversation, in `agent.md`.                            |
| Skills               | 技能               | スキル                   | Named, reusable instructions, called with `/name`.                                     |
| Global config folder | 全局配置文件夹     | グローバル設定フォルダー | The app's folder for the writing instructions and skills that apply to every document. |
| Built-in skills      | 内置技能           | 組み込みスキル           | The 18 skills that come with the app; each can be turned off, customized or reset.     |
| Writing conventions  | 写作规范           | 表記ルール               | The punctuation, spacing and number norms followed, per document language.             |
| Modes                | 写作 / 审阅 / 修订 | 執筆 / レビュー / 推敲   | What a conversation may do to the document: add text, nothing, or change it.           |

### Project folder

**The folder Textus AI works in: it may read and search the text files
there, and the project's own settings live in its `.textus/` folder.**

- **On disk:** the folder of the document being edited, unless the user
  chose another one.
- **Create / edit:** nothing to create - saving a document makes its folder
  the project folder. **Choose project folder…** in the project bar's menu,
  or **Settings > Textus AI > Project Folder**, picks another one; **Use the
  document's folder** goes back to the default.
- **Textus AI uses it:** conversations list, read and search its text files
  (`list_files`, `read_file`, `search_files`), and `@` in the composer
  attaches one. Hidden entries, build and dependency folders and files over
  100 KB are skipped, and nothing outside it can be read.
- In code it is the _workspace root_ (`settings.agentWorkspaceRoot`,
  `workspace::project_root`). Settings called it "Workspace Folder" up to
  0.9.6.

### `.textus/` folder

**The project's settings folder: a hidden folder inside the project folder
that holds the project's style profile, library, writing instructions and
skills.**

- **On disk:** `<project folder>/.textus/`.
- **Create / edit:** created on first use by the project bar's menu items,
  or by hand.
- **Textus AI uses it:** only through the roles below. The file tools never
  read hidden folders, so nothing in `.textus/` reaches the model as
  reference material.

### Style profile ("Learn my style")

**A description of how the author writes - voice, sentence rhythm, word
choice, things they never do - that Textus AI writes to.**

- **On disk:** `.textus/style.md`. Learning again keeps the previous profile
  as `.textus/style.previous.md`.
- **Create / edit:** **Learn my style from samples…** in the project bar's
  menu - the user picks up to eight of their own text files, the chat model
  drafts a profile (voice and tone, sentences and rhythm, word choice,
  punctuation and formatting, structure, never, quoted examples) in the
  samples' language and it opens in a new tab for review. Or **Create style
  profile**, an empty outline. Once it exists, the **Style** chip opens it.
- **Textus AI uses it:** with every conversation request and every
  completion in the project (the first 6,000 characters), under
  `---the author's style profile---`.

### Library

**Facts about the project's people, places and terms that must stay
consistent, one entry per file.**

- **On disk:** `.textus/library/<name>.md` - frontmatter `name`, `aliases`
  and `include` (`detected` by default, `always` or `never`), then the
  facts.
- **Create / edit:** **New library entry…** in the project bar's menu asks
  for the name and opens the new file; or by hand. The **Library N** chip
  shows how many entries there are.
- **Textus AI uses it:** an entry goes with a request when it is `always`,
  or `detected` and its name or an alias (two characters or longer) appears
  in the request - the message plus the document for a conversation, the
  text around the cursor for completion. At most about 8 KB of entries per
  request; entries nobody mentions cost nothing.

### Writing instructions (`agent.md`)

**Standing rules sent with every conversation: what the project is, the
reply language, spellings and terms, things to always or never do.**

- **On disk:** global: `agent.md` in the global config folder; project:
  `.textus/agent.md`.
- **Create / edit:** global: **Settings > Textus AI > Writing Instructions
  (agent.md) > Edit agent.md**; project: **Edit project writing
  instructions** in the project bar's menu. Both open in a tab, starting as
  a how-to written in `<!-- -->` comments.
- **Textus AI uses it:** in the system prompt of every conversation, under
  `---user instructions---`, with comments stripped. Not used by completion
  or grammar check.

### Skills (`/name`)

**A named, reusable set of instructions in one Markdown file, which the user
calls with `/name` or Textus AI loads by itself when a request matches its
description.**

- **On disk:** built-in: 18 skills bundled with the app
  (`src-tauri/src/ai/skills/*.md`, read-only); global: `skills/*.md` in the
  global config folder; project: `.textus/skills/*.md`. Frontmatter `name`
  and `description` (block scalars allowed), Textus-only keys under
  `metadata:` (`textus-invocation`, `textus-category`, `textus-packs`,
  `textus-aliases-<lang>`, `textus-version`, `textus-based-on`), then the
  instructions. `<!-- -->` comments in the instructions are never sent.
- **Create / edit:** **Settings > Textus AI > Skills > Import Skill…** copies
  a file into the global skills; **Customize…** on a built-in copies it
  there with `textus-based-on` (so **Reset to built-in** may delete it); or
  by hand in either folder. A built-in can be turned off
  (`settings.disabledBuiltinSkills`).
- **Reference packs:** `contract`, `craft` and `standards-<lang>` for ten
  languages (`src-tauri/src/ai/skills/packs/`), never listed or called with
  `/`. A skill's `textus-packs` sections (`standards#dialogue` = the
  document language's pack) are appended to its instructions whenever it is
  used, and the model can load any section with
  `use_skill("standards-fr#dialogue")`. Attribution:
  `src-tauri/src/ai/skills/ATTRIBUTION.md`.
- **Textus AI uses it:** the name and description of every skill it may
  start (`textus-invocation: both`; not `user-only` ones like `/tighten`, not
  turned-off built-ins) are listed in the system prompt
  (`---available skills---`) for tool-calling providers, the user's own
  marked "(project)" or "(yours)" and preferred over a built-in when both
  match; the body arrives through `use_skill`, or - when the user types
  `/name` or an alias (`/校对`) - already expanded by Rust
  (`builtin::expand_message`) in a `<skill name="...">` block, which the
  agent follows without loading it again. Conversations only.

### Global config folder

**The app's own folder for what applies to every document: the global
writing instructions and the global skills.**

- **On disk:** `agent/` in the app config directory -
  `~/.config/com.catvinci.textus/agent/` (Linux),
  `~/Library/Application Support/com.catvinci.textus/agent/` (macOS),
  `%APPDATA%\com.catvinci.textus\agent\` (Windows).
- **Create / edit:** **Settings > Textus AI > Global Config Folder > Open
  Folder** (desktop) creates it with a starter `agent.md` and shows it in
  the file manager; **Edit agent.md** and **Import Skill…** write into it.
- **Textus AI uses it:** read before the project's `.textus/` on every
  conversation request. It has no style profile or library: those describe
  one body of work, so they belong to a project.

### Writing conventions

**Which national norm or house style a document's mechanical conventions
follow - punctuation, spacing, quotes, numbers, spelling lists - per
document language: a profile such as `zh-Hans-CN/fiction`, `en-GB/govuk` or
`fr-CA`, or Automatic.**

- **On disk:** global: the `writingConventions` setting in `settings.json`
  (`"automatic"`; one profile as a string, which is what the Settings row
  stores and applies to documents in that profile's language; or an object
  from language to profile, with an optional `options` object); project: the `conventions:` key (one profile, or
  several separated by commas, one per language) and option keys such as
  `cjk-latin-space: on` in the front matter of `.textus/style.md`. The
  profiles and option keys are listed in
  `src-tauri/src/ai/rules/profile.rs` (`LANGUAGE_PROFILES`, `OPTIONS`) and
  mirrored in `platform/ipc.ts` (`WRITING_CONVENTIONS`).
- **Create / edit:** **Settings > Textus AI > Writing Assistance > Writing
  conventions** (default Automatic) for the global choice; the style
  profile's front matter for a project, which wins for the languages it
  names.
- **Automatic:** the national norm where there is one (GB/T for Simplified
  Chinese, the MOE handbook for Traditional, JTF for Japanese, the national
  rules for Korean and Russian, Brazilian Portuguese), none for English,
  Spanish, French and German. Wherever sources disagree (CJK-Latin spacing,
  French spacing, quote systems, serial comma, -ize/-ise...), Automatic
  follows the document's own majority and flags only the minority.
- **Textus AI uses it:** through the deterministic rules engine
  (`src-tauri/src/ai/rules/`): the grammar check adds the engine's findings
  to the model's; conversations get the read-only tools
  `check_conventions` and `measure_text`, and each proposal's text is made
  to follow the P0 conventions the document already follows before the
  user sees it; completions are made to match the text before the cursor.

### Not a file: modes

**What a conversation may do to the document, picked in the composer:
Write (写作) only adds new text, Review (审阅) only reads, answers and
comments, Revise (修订) changes the text that is there.**

- **Where:** the mode picker beside the composer (a segmented control on a
  phone), in the order Write, Review, Revise. The panel starts in
  **Settings > Textus AI > Textus AI Chat > Default mode** (Review by
  default) and remembers the last pick; Quick Ask starts in Revise.
- **Textus AI uses it:** the prompt's `---interaction mode---` section,
  and the tools: Review gets no `propose_edit`, Write gets it with the
  insertion actions only (append, insert_at_cursor, insert_after,
  insert_before - after a selection, never over it), Revise with every
  action. Every proposal is decided by the user either way
  ([ai-proposals.md](ai-proposals.md)).
- In code: `AgentMode` (`settings/SettingsContext.tsx`,
  `ai/agent.rs`) with the values `write`, `review` and `revise`. 1.0 called
  Review "Ask" and Revise "Edit" and had a Plan mode; stored values from
  then are read as today's (`migrateAgentMode`), Plan as Review.

### Not a file: completion tone

The **completion tone** (Settings > Textus AI > Writing Assistance) is a
preset directive added to completion prompts only. It is a setting, not
part of the project.

## Precedence

| Applies to                                | Conversations | Completion | Grammar check |
| ----------------------------------------- | :-----------: | :--------: | :-----------: |
| Project files (read, search, `@`)         |       ✓       |            |               |
| Style profile                             |       ✓       |     ✓      |               |
| Library entries the request mentions      |       ✓       |     ✓      |               |
| Writing instructions (global and project) |       ✓       |            |               |
| Skills (global and project)               |       ✓       |            |               |
| Completion tone                           |               |     ✓      |               |
| Writing conventions                       |       ✓       |     ✓      |       ✓       |

- **One project folder at a time.** A chosen folder is a single setting
  and applies to every document, unsaved drafts included, until **Use the
  document's folder**. A chosen folder that no longer exists falls back to
  the document's folder. With neither (an unsaved draft, nothing chosen)
  there is no project: no file tools, style profile, library, project
  instructions or project skills - the global layer still applies. A folder
  that is too broad (the home folder, a drive root) is refused, whether
  chosen or the document's own.
- **Only the project folder's `.textus/` counts.** When the user chose a
  folder, the `.textus/` next to the document is not read.
- **Writing instructions add up.** The global `agent.md` comes first and the
  project's after it. With one layer the section is headed
  `---user instructions---`; when both are present the project's section is
  headed as below, so the project wins a conflict:

  ```text
  ---user instructions for this project (where they conflict with the ones above, follow these)---
  ```

- **Skills merge by name.** A project skill replaces a global skill with the
  same `name`, and either replaces a built-in one; all other skills from
  the three levels are available.
- **The style profile and library are per project only.** There is no
  global version of either.
- **Completion tone and style profile both reach completion.** The tone is
  a one-line preset, the style profile the detailed description; "Match the
  document" adds no tone, which suits a project with a style profile.
- **Changes apply on the next request**, without a restart: conversations
  read these files on every request, completion caches them for up to ten
  seconds, and the project bar re-reads them when the window regains focus.

## Where the user meets each concept

- **Settings > Textus AI**, group "Writing Instructions & Skills": Project
  Folder (its hint names the folder Textus AI may read), Writing Instructions
  (agent.md) (hint: for all documents), Skills (hint: how to call one) and
  Global Config Folder (no hint). Few hints on purpose; the guide explains.
- **The AI panel's project bar**: the folder name (tooltip: "Project folder"
  and the path), the **Style** and **Library N** chips, and the menu that
  chooses the folder and creates each project-level file.
- **Help > AI Features Guide**, section "Make Textus AI yours": an overview
  table, one subsection with a small example per concept, "Which applies
  when" and "Which file for what".
- **The files themselves**: the style profile, a new library entry and both
  `agent.md` starters explain themselves in comments, which never reach the
  model.
- **Textus AI itself**: the agent's prompt (`agent.rs`'s `workspace_section`)
  says which project folder is in use and why, describes each concept in
  English with the project menu's items, the **Style** chip and the
  Settings rows that make and open it (and what reaches completion), and
  hands over the same names in the user's UI language as a table
  (`src-tauri/src/ai/ui-names/<code>.txt`, only that one language), to be
  used when replying in it, so its answers point at labels that exist.
  Without a project folder it names only the Settings row: the project bar
  isn't shown then. Unit tests check every name in each table against that
  language's strings (`src/i18n/locales/<code>.ts`) or, for "project menu",
  its help guide, and the "Learn my style" headings
  (`src-tauri/src/ai/style-headings/<code>.txt`) against the starter
  profiles; the live eval's `concept/` cases check the replies.

## Names in code

Some identifiers predate these names. They stay; their comments use the
names above.

| User-facing name     | In code                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project folder       | workspace root: `settings.agentWorkspaceRoot` (`""` = the document's folder), `workspace::project_root`, `AgentWorkspace.root`                                    |
| `.textus/` folder    | `WORKSPACE_DIR_NAME`                                                                                                                                              |
| Style profile        | `AgentWorkspace.style`, `project::read_style`, `learn_style`                                                                                                      |
| Library              | `AgentWorkspace.library`, `project::read_library`, `project::relevant_library`                                                                                    |
| Writing instructions | `AgentWorkspace.instructions` (global) and `AgentWorkspace.project_instructions`; `agentSystemPrompt*` strings                                                    |
| Skills               | `AgentWorkspace.skills`, the `use_skill` tool, `import_agent_skill`, `ai::builtin`, `customize_builtin_skill`, `reset_builtin_skill`, `set_builtin_skill_enabled` |
| Global config folder | `global_agent_dir`, `agentWorkspaceLabel`                                                                                                                         |
