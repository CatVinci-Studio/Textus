# AI evaluation

How every AI feature in Textus is evaluated against the real Anthropic API,
what the first full evaluation found, what was changed because of it, and
what is still weak. The suite lives in `src-tauri/src/ai/live_eval.rs` and
`src-tauri/src/ai/live_eval/`; this document is its guide and its record.

## Concepts

One folder used to go by three names - "project folder" in the AI panel and
the tools, "Workspace Folder" in Settings, "the document's folder" in the
prompt - and agent.md by three more, so the agent made up its own ("I'm in
read-only mode", "I have no tool to open files"). Since 0.9.7 every place
uses the names of [AI-CONCEPTS.md](ai-concepts.md) (PR #42): the UI and the
in-app guide in en, zh and ja, and the agent's prompt, which is told the
same names, the project menu's items and the Settings rows, and what each
thing is (`agent.rs`'s `workspace_section`; unit tests check every label it
quotes against `src/i18n/locales/`). The eval's case ids keep their
round-2 groups so runs stay comparable: `workspace/` is the project folder,
`agentmd/` the writing instructions, `style/` the style profile and "Learn
my style".

| Concept                                                                               | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Where it lives                                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project folder** (项目文件夹 / プロジェクトフォルダー; in code, the workspace root) | The one folder Textus AI may read (`find_files`, `list_files`, `read_file`, `search_files`, @-mentions), and whose `.textus/` folder holds the project's settings. The open document's own folder by default (`RootSource::DocumentFolder`), or one the user chose (`Chosen`). An unsaved draft with no chosen folder has none (`None`): no file tools are offered, and the agent says why and how to fix it. A home folder or drive root is never used (`TooBroad`). | The project menu (the folder name in the bar under the AI panel's header: Choose project folder…), or Settings > Textus AI > Project Folder; resolved by `workspace::load_from` |
| **Writing instructions** (写作要求 / 執筆の指示, agent.md)                            | Standing rules sent with every conversation: the global ones, then the project's, which win where they conflict (their section says so when both exist).                                                                                                                                                                                                                                                                                                              | The global config folder's `agent.md`; `.textus/agent.md` (Edit project writing instructions)                                                                                   |
| **Skills** (技能 / スキル)                                                            | Reusable instructions: the index (name + description) is in the prompt, the body loads with `use_skill` - or arrives already expanded in a `<skill name="...">` block when the user types `/name`. A project skill shadows a global one of the same name.                                                                                                                                                                                                             | `agent/skills/*.md`; `.textus/skills/*.md`                                                                                                                                      |
| **Library** (资料库 / ライブラリ)                                                     | Facts about characters, places and terms. An entry is sent when the request, selection or text around the cursor mentions its name or an alias (`include: detected`), always, or never. It is a constraint on what is written, not text to recite.                                                                                                                                                                                                                    | `.textus/library/*.md` (New library entry…)                                                                                                                                     |
| **Style profile** (文风档案 / 文体プロファイル)                                       | How the author writes - voice, sentence rhythm, word choice, punctuation, what they never do - which both the agent and inline completion follow for every document in the project folder. Its concrete limits (sentence length, banned words or punctuation) are rules; its habits apply where they read naturally and never override the request (an expansion still gets longer) or the sense of the text.                                                         | `.textus/style.md`                                                                                                                                                              |
| **Learn my style** (学习我的文风 / 文体を学習)                                        | Drafts the style profile from samples of the author's own writing (`project::learn_style`, `STYLE_INSTRUCTIONS`), in the samples' language, with the headings of the app's own template in en, zh and ja; the author reviews and edits it in a tab. The previous profile is kept as `style.previous.md`.                                                                                                                                                              | The project menu: Learn my style from samples…                                                                                                                                  |
| **Global config folder** (全局配置文件夹 / グローバル設定フォルダー)                  | The app's folder for the writing instructions and skills that apply to every document. No style profile or library: those belong to a project.                                                                                                                                                                                                                                                                                                                        | `agent/` in the app config dir; Settings > Textus AI > Global Config Folder                                                                                                     |
| **Completion tone**                                                                   | A preset register for inline completion only (formal, casual, academic, concise), the same in every document. It sets the register; the style profile is the author's own voice.                                                                                                                                                                                                                                                                                      | Settings > Textus AI > Writing Assistance (`completion-style.ts`)                                                                                                               |
| **Write / Review / Revise mode** (写作 / 审阅 / 修订; 執筆 / レビュー / 推敲)         | The panel's modes: Write proposes new text only (append and the insert actions); Review reads, answers and comments, with no edit tool; Revise can propose any edit. An edit asked for in Review mode gets the text in the reply and a pointer to Revise mode; a change to existing text asked for in Write mode, a pointer to Revise mode.                                                                                                                           | The composer's mode picker                                                                                                                                                      |
| **Quick Ask**                                                                         | The chat bar under the current paragraph: the same agent and prompt, opened in Revise mode on the selection it captured; each follow-up is sent against that range as mapped through accepted edits.                                                                                                                                                                                                                                                                  | Cmd+Shift+K                                                                                                                                                                     |

## What is evaluated

Each case goes through the app's real code path: the same system prompts,
tool definitions, agent loop, completion and grammar prompts, and the same
post-processing (`finish_completion`, `finish_grammar`). Where the
frontend does something to the model's output, the eval mirrors it - for
example `checks::apply_all` composes an accepted `propose_edit` exactly as
`src/ai/doc-markdown.ts` does, and the completion's "what the user sees"
applies the editor's `stripEcho` and `tidySuggestion`. Requests use the
app's own sampling settings (no temperature override; Haiku's thinking is
disabled for completions as in the app).

### The matrix

| Suite        | Cases | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`      |   158 | Round 1 (75 cases): **Languages**: one report in en, zh-Hans, zh-Hant, ja, ko, es, fr, de, ru, pt and mixed Chinese/English, each asked a question and asked to tighten a paragraph; requests in a different language from the document; translation (whole paragraph, and a selection). **Markdown**: edit a table cell, add a table row, fix a bug in fenced Python and JS, check off a task (en, ja), add a nested list item, fix display math, add a footnote, shorten a GitHub alert, change a link, edit YAML front matter, raw HTML, a Mermaid diagram, rename a heading, rewrite a paragraph that carries a link, inline math and a footnote ref, change an image's alt text, answer a question about the document. **Agent behaviour**: summarise (in chat, and into the document), expand, rewrite formally, delete a sentence, continue, replace a selection, insert at the cursor (en, zh) and inside a sentence, review with comments (edit mode and ask mode), questions that must not become edits, plan mode, two ambiguous requests, three multi-turn follow-ups (accept then "same again", reject then retry, question then act), agent.md (reply language + spelling; Chinese conventions), the style profile, the library (a fact by alias; character consistency), a `/skill` and a skill matched by description, facts from a project file, one section of a 60k-character document. |
| `completion` |   105 | Round 1 (43 cases): Every tone preset (default, formal, casual, academic, concise) on English mid-sentence, English long continuation and Chinese after-sentence text; mid-sentence in every matrix language; list item (en, zh), table cell, heading (en, zh), blockquote; a Python code block with the `code block` hint the editor sends (round 2 dropped the old `paragraph`-hint variant); after-text (manual trigger mid-document); three candidates (en, zh); the cursor inside a word (en, fr, de); a nearly empty document.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `grammar`    |    61 | Round 1 (26 cases): Each strictness level on real mistakes and on correct text (where any report is a false positive); typos (en, zh, zh-Hant wrong script, ja, ko), grammar (en, zh 的/地, fr, de, es, ru, pt), code tokens / URLs / math / names / dialogue that must be left alone, "typos" mode on a paragraph that also has a grammar mistake, strict mode on wordy text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| model runs   |       | `agent-models`: 17 agent cases (one of each kind) on Haiku 5.5, Sonnet 5.5 and Opus 5.5. `completion-models` / `grammar-models`: both suites on Haiku 5.5 and Sonnet 5.5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Round 2 additions

Round 2 (`agent_everyday.rs`, `agent_workspace.rs`, `completion_cases.rs`,
`grammar_cases.rs`) added many more Chinese and English cases and made the
workspace and writing-style features explicit.

- **Agent, everyday writing (25 zh + 25 en)**: emails, a weekly report and
  a support review with tables, academic paragraphs with citations,
  technical docs with code (a JS bug, Python comments to translate, a
  numbered step to add, inline code to keep), meeting notes (check off a
  task, turn items into a checklist, add a deadline), essays (vivid without
  inventing, cut clichés, continue), fiction with dialogue (action beats,
  quote marks kept, insert at the cursor, continue the scene), social posts
  under a length limit, product copy into a list; casual ("can u make the
  first para shorter") and formal phrasing; a 42k-character Chinese report
  edited and quoted in the middle (outline only, must read chapter 7).
- **Quick Ask vs the panel**: both send the same `ai_agent_message`; the
  differences are that Quick Ask opens in Revise mode on the selection it
  captured and sends every follow-up against that range as mapped through
  the accepted edits (`useInlineChat`'s `sendContext`, chat-selection-plugin),
  while the panel defaults to Review mode and sends the live selection or
  cursor. Cases: a single Quick Ask edit (zh, en), a five-turn Quick Ask
  conversation on one paragraph (zh) and a five-turn panel conversation
  (en), and an edit request sent in the panel's default Review mode (zh, en),
  where no edit tool exists.
- **Workspace**: the folder the AI may read - the open document's own
  folder by default, or the folder picked in the panel - with project files
  (`find_files`/`list_files`/`read_file`/`search_files`), the library
  (`.textus/library/*.md`, entries sent when their name or an alias is
  mentioned), `.textus/agent.md`, `.textus/skills/*.md`, plus the global
  config folder (`agent/` in the app config dir) whose agent.md and skills
  apply everywhere and are shadowed by the project's. Each case builds the
  folders on disk and loads them through `workspace::load_from` (the app's
  loader): facts from notes next to the document, other chapters searched,
  a path outside the folder (relative and absolute; nothing may leak), an
  unsaved draft with no folder at all, the override pointing elsewhere (the
  document folder's agent.md must then not apply), agent.md in zh and en
  (reply language, house style, comments stripped, global + project
  layers), library facts by alias and a character-consistency check, a
  `/skill` and a skill matched by description, a project skill shadowing a
  global one. Since the built-in skills, these disk workspaces also carry
  the 19 built-ins (the loader adds them, as in the app), and a `/name`
  message is expanded by the production `builtin::expand_message`, packs
  included; the in-memory workspaces of the matrix cases don't.
- **Concepts (added in the 0.9.7 integration, 8 cases)**: questions about
  the style profile, the library, global and project writing instructions,
  skills and the project folder, in en, zh and ja; the reply must use the
  UI's names in the user's language (`concept/`, see Round 2 integration).
- **Writing-style learning**: "Learn my style" (`learn_style`) run on three
  samples each in zh and en; the profile is checked for the seven sections,
  the samples' language, examples quoted verbatim from the samples (so none
  are invented) and the habits the samples share (「」 quotes, no
  exclamation marks, short sentences; British spelling, second person, no
  semicolons). Then an edit and a completion under the learned profile,
  edits and completions under hand-written profiles with hard rules (a
  sentence-length limit, banned words, a punctuation habit), a profile in
  English applied to Chinese text and the reverse, and Quick Ask under a
  profile.
- **Completion (21 zh + 23 en + 16 other + 3 style)**: the same everyday
  genres; inside an open Chinese and English quote; poetry as one line per
  paragraph and as hard breaks; an empty paragraph after a heading and after
  a long section; list items, numbered steps and table cells; JS code; a
  list item and another block in every other matrix language (a Japanese
  list item among them).
- **Grammar (13 zh + 14 en + 8 other)**: 的/地/得, half-width punctuation in
  Chinese, homophone typos, measure words, mixed Chinese/English text,
  articles, agreement, tense, run-ons, correct dialect, British spelling and
  long sentences that must stay clean, and paragraphs with inline
  formatting (`**bold**`, `` `code` ``, links): the check gets the block's
  textContent, and every fix must not cut across bold or a link or touch
  code, and must write back into the Markdown with every marker intact.
  Long multi-mistake paragraphs in Korean and German.

**The documents are what the app shows.** The agent's documents are
Markdown fixtures in `live_eval/docs/` that `src/editor/eval-docs.test.ts`
round-trips through the real editor and `doc-markdown.ts`'s serializer in
CI: `*` bullets, padded tables, escaped `\$`, no trailing newline. (It also
showed that the editor writes a GitHub alert marker as `> \[!NOTE]` - see
Remaining weaknesses.) The `<cursor>` block mirrors `caretContext`: 160
characters of plain text either side, blocks separated by a newline.

### Built-in skills suite (`agent-builtin`)

The built-in writing skills (the 18 skills of the built-in skills
catalogue, `src-tauri/src/ai/skills/`) have their own suite,
`live_eval/agent_builtin.rs`, run as `agent-builtin` so the `agent`
matrix's numbers stay comparable with earlier rounds. It has 76 cases:

- **56 skill cases**, `builtin/<skill>/<lang>/<case>`, two to four per
  skill: `continue-story` (zh with library and fiction profile, en matched
  by description, ja dialogue marks, zh options only), `describe`,
  `dialogue` (zh punctuation only, en tags, es raya, de §79 commas),
  `imitate-style` (a sample file, the style profile), `expand` (TBD costs
  must not become prices), `tighten` (de, ja, en to a word target),
  `change-tone` (ja である調, ko 하십시오체, plain English, a firmer zh
  email), `de-ai` (en and zh rewrites, a check-only request, a dialogue
  guard), `translate` (en->zh, zh->ja, Simplified->Taiwan), `proofread`
  (seeded errors in zh, en, fr and ko), `continuity` (library and earlier
  chapters), `email`, `notice` (zh 请示, ko 공문서, en notice, zh-Hant 函),
  `minutes`, `academic-polish`, `social-post` (X, 小红书, the advertising
  law), `headline` (options, a 公众号 title, a project skill that shadows
  the built-in) and `summarize`.
- **20 routing cases**, no `/`: 14 `route/<skill>/<lang>` requests whose
  wording should load that skill by its description (one per model-invoked
  skill, across all ten languages), and 6 `route/none/<lang>/<case>`
  requests that should load none - a question about the document, "怎么开启续写？"
  (the completion setting, not `continue-story`), "Make the second
  paragraph shorter." (`tighten` is `/`-only), a question about a selected
  paragraph, a one-character title fix (`proofread` tolerated) and a
  one-word translation question (`translate` tolerated). Each routing row
  records its latency; a routed skill that adds more than about 8 s on
  short requests should become `/`-only.

Every case builds its folder on disk and loads it through
`workspace::load_from`, so the built-in layer, the global and project
skills that shadow it, the library and the style profile (with its
`conventions:` front matter) are what the model gets. A `/name` message is
expanded as the app expands it, and every such case also checks that it
was (`expanded as the skill`): a missing built-in fails loudly instead of
quietly measuring the base agent. Eighteen new fixtures (`novel-ja`,
`dialogue-{zh,en,es,de}`, `ai-{en,zh}`, `proof-{zh,en,fr,ko}`, `email-ko`,
`email-ja-notes`, `qingshi-zh`, `gongmun-ko`, `han-tw`, `office-move-en`,
`standup-en`) are round-tripped by `eval-docs.test.ts` like the others.

Checks added for it (`checks_builtin.rs`, unit-tested in CI):
`measured` (characters, CJK characters, words, X's weighted length with
URLs at 23 and emoji sequences at 2), Japanese and Korean register
(です・ます / である, 하십시오체 / 해요체 / 해라체) per finished sentence,
`max_overlap` with a style sample (n characters or words), punctuation-only
edits, paired `……` / `――`, missing commas before speech tags, adverb
tags, list items in a reply, task items, hashtags, and edits that must land
between two anchors. `use_skill` calls are read from the record, so a case
can require one skill, none, or "none or this one"; hidden reference packs
(`contract`, `craft`, `standards-*`) don't count as skills.

**`conventions_clean`** runs the deterministic rules engine
(`src-tauri/src/ai/rules/`) over the paragraphs an edit touched, with the
case's conventions profile (`zh-Hans-CN/fiction`, `fr-FR`, `en-US/general`
...) at the "standard" level, and fails on any error or warning (no P0 or
P1 finding; `info` notes are document-level and ignored). It reaches the
engine through `live_eval/conventions.rs`, an adapter with the engine's
`check(text, lang, profile, level) -> Vec<Finding>` shape. Until the engine
is wired in there, `engine()` returns None and the check is recorded as
`conventions clean (<profile>): not checked (no rules engine)` and passes -
the name says it measured nothing.

**Running it cheaply.** Size a run first, free and with no key:

```sh
cargo test --lib live_eval::list_builtin_cases -- --ignored --nocapture
TEXTUS_EVAL_FILTER=builtin/proofread/,route/none/ cargo test --lib live_eval::list_builtin_cases -- --ignored --nocapture
```

It prints one line per case (id, mode, user language, message), the count
per group and an estimate at $0.02-0.03 a case without the judge. Then run
the automatic checks only, filtered, under a budget:

```sh
TEXTUS_EVAL_JUDGE=0 TEXTUS_EVAL_BUDGET_USD=1 TEXTUS_EVAL_FILTER=builtin/dialogue/ \
  cargo test --lib live_eval::live_agent_builtin -- --ignored --nocapture
TEXTUS_EVAL_JUDGE=0 TEXTUS_EVAL_BUDGET_USD=4 TEXTUS_EVAL_SPEND_FILE=~/textus-eval-spend.json \
  cargo test --lib live_eval::live_agent_builtin -- --ignored --nocapture
```

The whole suite is about $2 at list prices with `TEXTUS_EVAL_JUDGE=0`
(76 cases); `TEXTUS_EVAL_FILTER=builtin/` or `route/` runs one half. The
judge (`TEXTUS_EVAL_JUDGE` unset) roughly doubles the cost; the cheaper
way is to judge the `agent-builtin.jsonl` rows afterwards with subagents,
each row carrying its rubric and the judge's material. Pass bar: every automatic check;
judge good or acceptable on at least 90% of each skill's cases; routing
positives load the right skill in at least 90% of cases and negatives load
none in at least 95%.

### How a case is judged

**Automatic checks** (hard - a failure fails the test):

- Edit or no edit, as the request calls for; comments for reviews; every
  proposal validates on its first try (a rejected anchor costs the user a
  retry round trip).
- Reply language = the language of the user's message; the text an edit
  writes = the document's language (or a translation's target). Detected
  from script ratios, a 70-pair simplified/traditional character table and
  per-language word lists (`checks::detect`).
- **Byte identity outside the target**: the changed span of the document
  (common prefix/suffix) must lie inside the passage the request named.
- **Structure**: both versions are parsed with pulldown-cmark (GFM tables,
  task lists, footnotes, math, alerts, front matter) into a block skeleton;
  it must be unchanged, or changed by exactly the expected delta (one more
  row with three cells, one task checked, one more nested item). Links,
  inline math, footnote refs and code spans can be required to survive.
- Shorter/longer, required strings in the result, tools that must be
  called (read before editing a long document, `use_skill`, `read_file`),
  and per-case checks (the title follows the skill's house style, the
  footnote is a new ref plus a new definition, the new item is nested...).
- Agent replies (round 2): no tool names or line numbers ("第91行") in what
  the writer reads; in Chinese and Japanese replies, no ASCII `, : ; ( ) "`
  against CJK text; the reply's language is detected without what it
  quotes (an English reply about a Chinese edit quotes Chinese).
- Completion: non-empty, no echo of the text before the cursor (and no
  text doubled at the join, `checks::doubled_at_join`), no leaked
  meta-commentary, no line break outside code, no figure the context
  doesn't have (`checks::new_numbers`), language, length bounds per mode
  (alternatives included), the word under the cursor finished correctly, a
  space where the language needs one, candidates count and distinctness
  (bigram similarity < 0.6).
- Grammar: the reply parses, every known mistake is flagged by an
  overlapping span, applying all suggestions yields the corrected text and
  writes nothing twice ("a an", "uns uns", "高兴的高兴地" -
  `checks::doubled_words`), no issue on protected spans, no extra issues
  beyond the case's allowance, issue descriptions in the paragraph's
  language. A fix inside inline code is dropped first, as the editor drops
  it (`touchesCode`).

- Writing conventions (round 3): the grammar matrix goes through the same
  `finish_grammar` as the app, so the rules engine's findings are merged
  in (with Automatic conventions); `checks::conventions_clean` asserts no
  P0 or P1 finding of the engine in a text, for cases that need it; agent
  rows carry `postfix`, the rules the proposal post-processing applied to
  that turn's `propose_edit` texts (`agent::postfix_step`), so a prompt
  regression shows instead of being silently repaired.

**Judging** (reported, not asserted). Round 1 had Opus 5.5 grade
faithfulness, helpfulness, minimality, tone and correctness from 1 to 5
against each case's rubric, through the API. Since round 2 the runs use
`TEXTUS_EVAL_JUDGE=0` and the grading is done by Claude subagents reading the
recorded rows (`<suite>.jsonl` carries everything a judge needs: input,
every tool call and result, the composed diff, the shown completion, the
applied grammar fixes, and the rubric), on the same five criteria with a
verdict (good / acceptable / bad), the problems quoted, and a likely cause.
That keeps the API spend to the cases themselves: the judge requests were
about two thirds of round 1's. The API judge (`harness::judge`) is still
there for runs that want it.

## Running it

From `src-tauri/`:

```sh
TEXTUS_ANTHROPIC_KEY_FILE=/path/to/key cargo test --lib live_eval -- --ignored --nocapture --test-threads=1
```

`--test-threads=1` runs the suites one after another; each suite runs six
cases at a time itself. Useful variables:

| Variable                    | Effect                                                                |
| --------------------------- | --------------------------------------------------------------------- |
| `TEXTUS_EVAL_FILTER`        | Only cases whose id contains one of these comma-separated substrings  |
| `TEXTUS_EVAL_AGENT_MODEL`   | Run the agent matrix on another model                                 |
| `TEXTUS_EVAL_WRITING_MODEL` | Run completion and grammar on another model                           |
| `TEXTUS_EVAL_JUDGE=0`       | Automatic checks only (much cheaper, about a third of the requests)   |
| `TEXTUS_EVAL_JOBS`          | Concurrent cases (default 6)                                          |
| `TEXTUS_EVAL_OUT`           | Output folder (default: a new folder under the system temp dir)       |
| `TEXTUS_EVAL_BUDGET_USD`    | Stop starting cases once this run has spent this much (list prices)   |
| `TEXTUS_EVAL_SPEND_FILE`    | A `{"spent_usd", "runs"}` ledger each finished suite adds its cost to |

Single suites: `cargo test --lib live_eval::live_agent_matrix -- --ignored --nocapture`
(also `live_agent_builtin`, `live_completion_matrix`, `live_grammar_matrix`,
`live_agent_model_comparison`, `live_writing_model_comparison`,
`live_agent_caches_across_steps`, `live_lists_every_model`).
`live_eval::list_eval_cases` is free and needs no key: it prints every case
id per suite after `TEXTUS_EVAL_FILTER`, for sizing a run before paying for it;
`live_eval::list_builtin_cases` does the same for the built-in skills suite
in more detail (see "Built-in skills suite").

Every suite writes to the output folder:

- `<suite>.jsonl`, one row per case with everything needed to judge it
  without re-running: `input` (the document, the script of messages with
  cursor or selection and whether proposals were accepted, the mode, the
  workspace as built on disk and as loaded, style samples, the completion's
  before/after text, hints, tone and profile, the grammar paragraph and its
  Markdown) and `output` (per turn: the message as sent, the focus heading,
  every tool call with its arguments and result, proposals, rejected
  proposals and why, comments, the composed document diff and the document
  after; the learned profile; raw, returned and shown completions with how
  each reads in place; grammar issues, the corrected text and the corrected
  Markdown), the automatic checks, latency, and token usage with its cost.
- `<suite>.md`, the summary table, and `<suite>.usage.json`, the suite's
  token and dollar totals.
- `cases-index.json`, one row per case of every suite run into the folder:
  `{suite, id, group, model, lang, passed_checks, failed_checks}`.

A case that never reached the API (rate limit, spending limit) is marked
with a failed `request` check, and one the budget guard skipped with a
failed `budget` check; both are counted in a warning - those rows say
nothing about the prompts.

Budget: every request's usage is recorded and priced (Sonnet 5.5 $2 / $10
per million input / output tokens, cache writes $2.50 and reads $0.20;
Haiku 5.5 $0.10 / $0.50). With `TEXTUS_EVAL_JUDGE=0` the round-2 baseline
cost about $0.01 for completion, $0.01 for grammar and a few dollars for
the 150 agent cases (see Results); an agent case averages about $0.02-0.03.
Prefer `TEXTUS_EVAL_FILTER` while iterating, set `TEXTUS_EVAL_BUDGET_USD`,
and run the whole matrix before and after a change. Completion and grammar
cost about a cent per full suite, so iterate on them with the whole suite.
The test binary's artifact name doesn't depend on the checkout, so with a
target dir shared between worktrees, copy the built binary somewhere
private before a long run - or give each worktree its own target dir:
round 2 had a shared one hand back another worktree's build of `aicompat`
mid-session.

The checking code itself (language detection, the Markdown skeleton, edit
composition, region and similarity checks, the tone directives staying in
step with `completion-style.ts`) is unit-tested and runs in CI with
`cargo test`.

## Prompt caching

The agent's cache used to last one message. Requests had a single
automatic breakpoint at the end, and the message being sent carries
the document (`request_context`) while history keeps it without, so nothing
a message cached was a prefix of the next message's requests: the first
request of every message read 0 tokens from cache and wrote the whole
prompt again (run1/run3 rows, five-turn cases).

What each Anthropic request marks now (`anthropic.rs`'s
`agent_request_body`; three explicit breakpoints plus the automatic one,
the API's limit):

- The last system block - tools and system prompt, the same for every
  message and every conversation in a project and mode.
- The end of the replayed history, and the end of the history before its
  newest exchange. The second is where the previous message put the first,
  so the entry it wrote is read back at a breakpoint of its own rather than
  through the 20-block lookback, however many tool steps that exchange took.
- The automatic one at the end, so each tool step reads the one before it.

That only pays if the history is byte-identical on every request.
`compact_history` cuts an old tool result to the same stub every time and,
over its budget, drops exchanges in 50k-character blocks whose boundaries
are fixed from the start of the conversation (it used to drop just enough
for each send, which moved the first message every turn). Where the next
block end is more than two blocks past what has to go - an exchange with a
long attachment inlined - it still drops just what has to go, rather than
the attachment with it. `run_agent_loop`
records a step's calls before their results, so each step's calls are one
assistant message the next step doesn't rewrite (they used to be merged,
which re-sent a read result uncached on the step after it). OpenAI
(Responses API) and chat-completions servers (DeepSeek, Qwen, Kimi, ...)
cache prefixes on their own and get the same stable history; nothing is
sent for them. No `prompt_cache_key`: OpenAI routes requests by their first
tokens, which every Textus request shares, and the key only matters past
about 15 requests a minute on one prefix.

Measured with `TEXTUS_EVAL_FILTER=five-turn TEXTUS_EVAL_JUDGE=0` (Sonnet 5.5;
before = run3, after = `ai-eval/cache`), tokens read / written per message,
both of its requests together:

| panel/en/five-turn | before        | after          |
| ------------------ | ------------- | -------------- |
| message 1          | 5,991 / 6,423 | 6,658 / 7,100  |
| message 2          | 6,534 / 6,964 | 13,534 / 1,322 |
| message 3          | 7,159 / 7,424 | 14,808 / 1,152 |
| message 4          | 7,575 / 8,038 | 15,823 / 1,153 |
| message 5 (1 req.) | 0 / 8,137     | 7,975 / 859    |

The first request of messages 2-5 now reads 6.3k-8.1k tokens (the system
prompt plus the history) and writes 0.7k-1.0k (the previous exchange and the
new message with its document), where it used to read nothing and write
6.5k-8.4k. Per case, cache writes fell from 37.0k to 11.6k tokens
(panel/en) and from 37.4k to 11.8k (quick/zh); the input side of the bill
(writes $2.50, reads $0.20 per million) from $0.098 to $0.041 and $0.099 to
$0.042, -58%; the whole case from $0.125 to $0.072 and $0.118 to $0.061
(output varies run to run). Both cases pass every check, as before.

`live_agent_caches_across_steps` now runs three messages on the 60k
document and asserts both kinds of read: message 1's steps read 6,329,
7,936 and 8,439 tokens - each everything the step before it sent - message
2's first request reads the 6,329-token system prompt and message 3's
7,863, the first exchange too. Message 1 also read the system prompt the
five-turn run had cached minutes earlier: it is shared across
conversations.

What still writes again: the message being sent, every time (it carries
the document); a proposal's status note that changes after it was first
sent (sent while undecided, accepted later), from that tool result on; and
anything after five minutes without a request - the cache's lifetime (the
one-hour lifetime doubles the write price).

## Results

### Round 4: built-in skills and the rules engine, judged and fixed (run4, run4-fix)

**What round 4 added.** The 18 built-in writing skills with their reference
packs (`src-tauri/src/ai/skills/`, the `agent-builtin` suite above: 76
skill and routing cases), and the deterministic writing-rules engine
(`src-tauri/src/ai/rules/`), which now runs in the grammar check, in the
agent's read-only `check_conventions` and `measure_text` tools, in
completion and proposal post-processing (`rules::postfix`), and in the
eval as the `conventions_clean` check. The `agent` matrix grew to 158 cases
(the style, library, skill and concept cases of round 3).

**The run.** Every suite once, with the subagent judge reading every row:
the `agent` matrix twice on Sonnet 5.5 (passes A and B, same prompts, to
see the run-to-run spread) and once on Haiku 5.5, `agent-builtin` split
into the skill cases and the routing cases, completion and grammar on
Haiku 5.5. Run4 cost $9.43 at list prices.

| Suite           | Rows | Good | Acceptable | Bad | Automatic checks all passed |
| --------------- | ---: | ---: | ---------: | --: | --------------------------: |
| agent, Sonnet A |  158 |  122 |         34 |   2 |                         156 |
| agent, Sonnet B |  158 |  130 |         24 |   4 |                         156 |
| agent, Haiku    |  158 |  118 |         34 |   6 |                         147 |
| builtin         |   54 |   38 |         15 |   1 |                     44 / 76 |
| builtin-route   |   22 |   15 |          6 |   1 |                          19 |
| completion      |  105 |   62 |         32 |  11 |                          99 |
| grammar         |   61 |   56 |          2 |   3 |                          59 |

(builtin: 54 rows judged; the other 22 skill rows had stopped at the
budget guard, `budget` check, and say nothing about the prompts.)

**Sonnet A against B.** The same prompts gave 122 and 130 good rows: about
eight rows move between good and acceptable from one pass to the next, so
a difference of that size between two runs is noise. What both passes got
wrong is the signal: the two cross-language cases (an English question
about a Chinese or Japanese document answered in the document's language)
were not good in both, and so were the "make it vivid, don't invent"
essay, product copy turned into bullets, the summarised dialogue in the
library case, the profile that turned a first-person account into "you",
and a Chinese shortening that only swapped words of the same length.

**Haiku against Sonnet.** Haiku scored only a little lower (118 good, 6
bad) at about a fifteenth of the price ($0.18 against $2.46-3.09 per pass).
Its failures cluster where Sonnet's don't: the reply language (English
replies to Chinese requests whenever a style profile was in the context -
five cases), claims about its own work that weren't true (comments it
never left, an eight-word title of nine words, "no new facts" over an
invented scene), refusing to reason one step past the text (task/expand),
and translation inserted beside the original instead of replacing it.

**Root causes and fixes (fix/creative-eval).** Grouped by the layer each
lives in; every deterministic change has a unit test.

- **Reply language (prompt, per turn).** The system prompt's rule lost to
  the document's language when a short request came with a CJK document.
  `agent::request_user_text` now heads the user's message with the
  language they typed it in, detected by `rules::detect` on what they
  typed - not the selection, the cursor's text, attached files or an
  expanded skill: `---the user's message (written in English: reply in
English, unless the user instructions set a reply language)---`.
  Simplified and Traditional Chinese are named apart (a Simplified request
  to convert a report got a Traditional reply).
- **Broken proposals (tool + frontend).** `propose_edit` refuses a
  replace whose `text` is one short Latin token for a CJK clause (Sonnet
  sent `"due"` for a 26-character apology, then could only ask the user to
  reject it), and a second proposal for a passage the same reply already
  changes (Sonnet sent the same French proofreading twice). A refused call
  never reaches the editor: `proposal-status.ts`'s `refusedProposalIds`
  keeps it out of the previews and the chat cards, `MilkdownEditor`
  removes a preview already streamed when its result refuses it, and
  `annotateProposalStatuses` never stamps a status on a refusal (a
  Playwright test streams one refused and one valid call).
- **Counts the user can't check (tool).** The proposal's size note counted
  ideographs only while `measure_text` counted punctuation too, and a
  reply told the user the two disagreed and to count again. The note now
  counts as `measure_text` does and says it is not for the user; the
  prompt allows a count only from a tool.
- **French no-break spaces (rules engine + post-processing).** Told the
  exact character, the model still typed ordinary spaces and told the user
  it had put in no-break ones. When the user chose a French profile
  (Settings or the style profile's `conventions:`), proposal
  post-processing now applies `fr.space.high-punct` and
  `fr.num.symbol-space` - only the kind of space changes; `85 %` with an
  ordinary space is now a `fr.num.symbol-space` finding; `check_conventions`
  judges a draft as it will be proposed (after post-processing), and says
  how to write the two spaces in JSON.
- **Agent prompt (`AGENT_ROLE`).** Replies check what they say against the
  proposed text, give counts only from a tool, never claim comments, edits
  or checks that didn't happen, and never describe how many proposals there
  are ("apply both"); the first words answer the question (the old
  instruction quoted the very preamble it banned, "这是个问题…", and the
  model kept writing it). Editing: an already tight or natural passage gets
  at most a light change and a word saying so; "cut the clichés" replaces
  them; bullets and selling points are rewritten as short parallel items;
  a summary condenses; a length the user gives is the length; a
  translation replaces the passage. Facts: with "don't invent" or in a true
  account (essay, memoir, report), "implied" detail means no new action,
  object, sound or smell; the plain consequence of what is stated is not
  invention; your own idea is never the author's plan; in fiction, a
  conversation asked for is written as dialogue, and library facts shape
  what characters do instead of being recited as backstory.
- **The app's own names (prompt).** The skill index gives each built-in
  skill its name in the user's UI (`continuity [/检查前后一致 in their
UI]`: the agent had invented "the 连续性 skill"); the project section
  says where completion is switched on and its tone set (new ui-names
  lines in all ten languages: Writing Assistance, Enable AI completion,
  Completion tone), how library aliases are written, and that a request
  for a skill starts from a built-in one and Customize….
- **Style profile.** "Learn my style" checks each bullet against every
  sample, writes content habits ("the pieces speak to 'you'") as habits,
  not rules, keeps the Never list to what no sample does, and doesn't wrap
  quoted examples in a second pair of quotes. The profile's header in the
  request says a habit of "you" never turns the author's own account into
  the reader's, and `imitate-style` keeps a first-person account first
  person.
- **Skills.** `minutes`: a Discussion section for feedback that is neither
  decided nor assigned, and the header and owners even when the notes are
  already sectioned. `social-post`: the source document is kept and the
  post inserted after it unless the document is a draft of the post; no
  platform named means a general version counted in characters.
  `translate`: a Simplified/Traditional conversion changes script and
  regional vocabulary only. `summarize`: "in N lines" is N sentences.
- **Completion (post-processing + prompt).** A suggestion with a figure
  the surrounding text doesn't have is dropped (Haiku wrote "返回 200" and
  a library's opening hours); a reply wrapped whole in ASCII quotes around
  CJK text loses them; a reply that reasons and then restates its first
  line keeps that line (the `率` table cell). The prompt says the word at
  the cursor may already be complete, a cut-off word is finished as the
  sentence needs, a letter is written from the writer's side, and verse
  keeps its line length. The casual and concise tone directives say
  concretely what changes (`completion-style.ts`).
- **Grammar (prompt).** Terms in another script don't exempt the grammar
  around them, and each corrected sentence is reread whole so a fix
  doesn't trade one error for another.
- **Checker.** `task/summary-into-doc` failed a correct summary that began
  with the intro's own words; `ja/typo/standard` accepted
  「面白かったでした」 (now it wants 「面白かったです」 or 「面白かった」);
  `process_talk` flags replies that describe how proposals fit together.

**Re-run (run4-fix, automatic checks only).** Only the affected cases,
`TEXTUS_EVAL_JUDGE=0`, outputs read by hand:

| Run                                  | Cases |               All checks passed | Before (same cases) |
| ------------------------------------ | ----: | ------------------------------: | ------------------: |
| agent, Sonnet (31 affected cases)    |    31 |                              31 |      29 (A), 29 (B) |
| agent, Haiku (the same 31)           |    31 |                              28 |                  20 |
| agent-builtin (11 affected)          |    11 | 8; 10 after two follow-up fixes |                   2 |
| completion (whole suite, last run)   |   105 |                              97 |                  99 |
| grammar (whole suite, last of three) |    61 |                              59 |                  59 |

Read by hand: both cross-language cases now reply in English; the formal
Chinese email has a real apology where "due" was; the 100-character post's
reply no longer mentions the tool's count; the library case writes the
exchange as dialogue; the vivid essay adds nothing the text doesn't have;
bullets have short parallel leads; "/检查前后一致" and the completion
setting are named correctly; the French proofreading lands with U+202F
and U+00A0 and the reply's claim is true; Haiku's Chinese style cases reply
in Chinese. Completion's lower count is the figure guard at work: four
suggestions that invented a figure are now empty instead (`non-empty`
fails where `no new figures` failed before); the echo-only headings
(`es/heading`, `ru/heading`), the cut-off "co" and the table cell are
fixed in most runs. Grammar is unchanged on the checks; its two persistent
misses are Haiku's (below).

**Spend.** Run4 $9.43; the fixes' re-runs $2.00 (agent Sonnet $0.97,
agent Haiku $0.05, agent-builtin $0.91, completion and grammar $0.07 over
six runs). Ledger total after round 4: $28.80 of the $29 cap
(`../assets/ai-eval/spend.json`).

**Still weak after round 4.**

- Haiku drops a reply language that comes from the writing instructions
  (global agent.md "always reply in English" with a Chinese request) - the
  per-turn header names the message's language and Haiku follows it over
  the instructions; Sonnet doesn't. Haiku also still declines to reason one
  step past the text (task/expand asks for the staffing fact instead of
  writing the inference).
- Completion still invents causes and findings that carry no figure ("the
  main driver was the faster first-response time", "这一担忧在不同年龄段
  的居民中都较为普遍"); the figure guard can't see those. Echo-only replies
  for a whole word at the cursor (`ru/heading`, "to" in a list item) still
  happen on some runs and show nothing.
- Grammar on Haiku misses "find it" for plural notes next to a Chinese
  term, Russian о → об before a vowel, and the でした after an
  i-adjective's past form - each needs the explicit rule in the prompt,
  which in turn pulled explanations into the example's language, so it was
  left out.
- `imitate-style` with a second-person profile still keeps a third-person
  methods paragraph in the third person ("you" would say the reader did
  it); the rubric wants "you". Whether that is right is a product call.
- Replies still sometimes list what was kept ("日期、时间、地点都没动")
  against the prompt, and still mention their own carefulness ("I added no
  new details").

### Round 2 integration, judged and fixed (run3-fix)

Subagent judges graded run3 with round 1's rubric - a verdict (good /
acceptable / bad) and a comparison with run1 (better / same / worse) per
row - by reading the rows, at no API cost: six judges of 15 agent rows
each, four for completion (30, 30, 30 and 15 rows) and two for grammar
(31 and 30). The counts below add up what the judges reported.

| Suite      | Rows | Bad | Acceptable  | Good     | Against run1 (better / same / worse)  |
| ---------- | ---: | --: | ----------- | -------- | ------------------------------------- |
| completion |  105 |   6 | at least 11 | the rest | 34 / 57 / 14                          |
| grammar    |   61 |   1 | 1-2         | the rest | 19 / 41 / 1                           |
| agent      |   90 |   1 | 2 reported  | the rest | 16 / 23 / 6 (45 rows), 8 worse in all |

Completion batch means were 4.0-4.15 of 5, agent rows mostly 4 and 5 (one
batch: six 5s and nine 4s). Three agent judges and three completion
judges named their weak rows without counting the rest, hence the partial
cells; the bad and worse rows are complete. What was worse than run1 is
mostly wording: a looser tone, a reply that describes its edit less
exactly. The bad rows:

- **Completion**: `midword/en` and `en/midword-cost` (empty: the model
  wrote "ument" after "docu", or reasoned before a usable line),
  `ru/heading` (the one-word heading answered with the word alone),
  `lang/de/mid` (a relative clause hung on the word at the cursor instead
  of finishing the verb-second clause), `en/email-after-sentence` (a
  lower-case fragment after a full stop) and `ja/list-item` (常備薬の服用, an
  action in a packing list).
- **Grammar**: `en/mixed-zh-terms` ("find it" for the notes, missed in all
  three runs).
- **Agent**: `style/cross/zh-profile-en-doc` (a Chinese reply to an English
  request under a Chinese style profile, claiming every sentence was under
  15 words when one had 21). Acceptable: `essay/en/vivid` (small invented
  details behind "no new events or people") and `skill/zh/slash` (85% of
  the length for a 70% skill, explained wrongly).

What the judges found across rows, and what was changed for it:

1. **The agent pointed at UI that isn't there**: both unsaved-draft
   replies sent the user to the project menu, but without a project folder
   the project bar shows nothing (a folder too broad shows only a notice).
   `workspace_section` now names only Settings > Textus AI > Project Folder
   then, and says the bar appears once there is a project folder.
2. **Labels it wasn't given never came up**: answers told users to write a
   hidden `.textus/style.md` by hand and gave no way back after choosing a
   folder. The prompt now names Create style profile, Open style profile,
   the Style chip, Use the document's folder, Accept and Reject; says the
   library goes by the user's message or the open document (it said "the
   request", which one answer turned into "you must name the character"),
   that the style profile and library also shape completion, and that
   there is one project folder at a time (choose a folder containing both).
3. **Names as glosses**: given inline as "style profile (文风档案 /
   文体プロファイル)", the names came back that way - three of eight concept
   answers in the first re-run had "style profile (文风档案)",
   "资料库（library）" or "(编辑本项目的写作要求 in the Chinese UI)". The prompt
   now describes the app in English and gives the Chinese and Japanese
   names as a table (`UI_NAMES`, every cell tested against `strings.ts` or
   the guides), with "never add a name from another language".
4. **How-to answers ran three to five blocks** with bullets, code blocks,
   tips and comments on the user's draft. They are now asked for two to
   four plain sentences: mean concept answer 594 -> 277 characters.
5. **The style profile set the reply language**: its header said "follow
   it in everything you write". It now says the profile shapes the text
   for the documents, never the reply's language, and the role says the
   same.
6. **Claims of compliance nobody checked** ("每句都在 20 字以内" over a
   26-character sentence): limits from the request, a skill, the style
   profile or the writing instructions are checked sentence by sentence
   before `propose_edit`, and an unchecked limit is never claimed. The
   `propose_edit` result also says not to send a second proposal when the
   first falls short of a target - in the third re-run, told its edit was
   86%, `skill/zh/slash` proposed a 70% version of the same paragraph
   again, and the two overlapped.
7. **Markdown in replies**: "the other lists still use `*`", a comment on
   the `\$` escape. Replies and comments now speak of bullets, checkboxes
   and bold, never of markers or escapes.
8. **Completion**: a removed tag left its line breaks behind ("率\n\n<br>"
   became "率\n\n" in a table cell, and the check trimmed them) - outside
   code, line breaks at either end are now dropped and the check counts
   them. A continuation after a finished sentence starts like a sentence.
9. **Grammar**: a fix that changes only spacing or punctuation between
   letters showed a lone apostrophe or space ("'" -> "", "번" -> " 번");
   such spans now take the words on both sides ("it's" -> "its", "두번" ->
   "두 번", "당황 했다" -> "당황했다"). Issue text uses the paragraph's
   punctuation (full-width, “ ” or 「」) and names only the corrected form
   as right (pt called "desde de manhã" correct).
10. **A /skill message showed its whole expanded `<skill>` block** in the
    transcript and as the conversation's title in History (since #47);
    `user-message.ts` now shows it as the /name the user typed.

Tried and dropped: keeping the word at the cursor in `<text-before-cursor>`
as well as in its tag, for `lang/de/mid` and `ru/heading`. The model then
went on from the cursor without writing the word out in five of the 19
judged cases, which the join won't place, so 12 of 19 passed (run3: 16)
and `ru/heading` still got the word alone (`run3-fix/try-word-in-before`).

Re-run with `TEXTUS_EVAL_JUDGE=0`, only the judged cases, output in
`../assets/ai-eval/run3-fix`:

| Suite                       | run3 (same cases) | run3-fix |   Cost |
| --------------------------- | ----------------: | -------: | -----: |
| completion (`c2`, 19 cases) |             16/19 |    17/19 | $0.003 |
| grammar (`g1`, 15 cases)    |             13/15 |    13/15 | $0.003 |
| agent (`final`, 25 cases)   |             23/25 |    24/25 |  $0.62 |

On the 25 agent cases the median latency fell from 7.3 s to 4.4 s and the
mean reply from 360 to 253 characters; `social/en/tweet` took 20 s instead
of 34 and came out at 269 characters with its parallel list intact. The
one failure is a Chinese reply quoting with ASCII marks
(`style/cross/en-profile-zh-doc`, which passed in the two earlier
re-runs). Read from the rows: the unsaved drafts name only Settings >
Textus AI > Project Folder; concept answers are short, use Create style
profile, the Style chip and completion, and say to choose a folder that
holds both; no glosses; `meeting/en/to-tasks` no longer mentions `*`; the
English request under a Chinese profile got English replies in all three
re-runs; `style/zh/rules` keeps every sentence within 20 characters and
says the expansion barely grew. Completion's two remaining failures are
`en/midword-cost` and `ru/heading`; grammar still misses "find it" and
"о истории". The completion and grammar re-runs are single samples:
`lang/de/mid` and `en/email-after-sentence` came out right this time.

The intermediate agent passes: `a1` (all 25, before the name table)
22/25, the three glosses; `a2` (concept and workspace cases, 12) 12/12;
`a3` (the other 13) 12/13, the double proposal above; `final` (all 25).

Spend: $1.89 at list prices - completion and grammar $0.01, agent $1.88
(`a1` $0.61, `a2` $0.19, `a3` $0.46, `final` $0.62). The ledger stands at
$17.12 of the $19 cap.

### Round 2 integration (run3)

Branch `integrate/ai-0.9.7`: `dev` (with #48) plus #42 (the concept model:
UI, guides, `.textus/agent.md` as its own layer) and #47 (the round-2
fixes), merged so that every place uses #42's names. Agent Sonnet 5.5,
writing Haiku 5.5, `TEXTUS_EVAL_JUDGE=0`, output in
`../assets/ai-eval/run3` (its `cases-index.json` has all 250 rows).

What the merge changed for the model:

- **One set of names in the prompt.** `workspace_section` now gives each
  concept in en, zh and ja (project folder / 项目文件夹 / プロジェクトフォルダー,
  writing instructions, global config folder, skills, library, style
  profile, "Learn my style"), the project menu's items, the Settings rows
  (Project Folder; Writing Instructions (agent.md), then Edit agent.md;
  Skills, then Import Skill…), how a skill is made, the Japanese mode
  names, and says to use each name only in the user's language. `AI_NAME`
  has a Rust twin; unit tests check every label the prompt quotes, and the
  "Learn my style" headings (now with a Japanese set), against
  `src/i18n/strings.ts`.
- **#42's layering**: with a global and a project agent.md, the project's
  section is headed as the one that wins a conflict
  (`agentmd/global-plus-workspace`); `<!-- -->` comments are stripped from
  style.md and library entries.
- **UI**: errors and tutorial cards that sent the user to "Settings → AI"
  now name the Textus AI page (from `AI_NAME`), with a test over every
  Settings path in the UI copy.
- **Cases**: a new `concept/` group (8 cases: en, zh, ja) asks how to make
  the agent write like the user, remember characters, follow rules
  everywhere or in one project, save a reusable instruction, and read
  another folder; the reply must use the UI's names, none of the retired
  ones ("workspace", 工作区, ワークスペース...) and none of another UI
  language's labels. Case texts say project folder, writing instructions
  and global config folder; ids keep their groups. `novel/en/beats` now
  checks the spoken words instead of counting quote marks (removing a tag
  that split one line of speech joins the two quotes - correct, but two
  marks fewer).

| Suite                                                        | run2 (same cases) |    run3 | p50 / p90 ms |   Cost |
| ------------------------------------------------------------ | ----------------: | ------: | -----------: | -----: |
| completion (whole suite)                                     |            98/105 | 102/105 |  1177 / 1911 | $0.014 |
| grammar (whole suite)                                        |             59/61 |   59/61 |  1313 / 2060 | $0.009 |
| agent: workspace, style, library, agentmd, skill, files (33) |                 - |   31/33 |              |        |
| agent: concept (8, new)                                      |                 - |     8/8 |              |        |
| agent: everyday regression guard (21 zh, 22 en)              |                 - |   43/43 |              |        |
| agent total (84)                                             |   40/43 in common |   82/84 | 7327 / 14364 |  $2.27 |

The agent cases ran three times as the prompt settled: pass 1 (the merge
and the en/zh/ja names) 83/84, failing only `novel/en/beats` on the quote
count; pass 2 (with the checker fix and how skills are made, after
`concept/zh/skill` sent the user to "create a skill in Settings") 84/84;
the final pass (each name only in the user's language, after one English
reply said "the style profile (文风档案)" and one Chinese reply "Edit 模式")
82/84. Its two failures are intermittent: `style/zh/rules` wrote one
26-character sentence under a 20-character profile, and
`style/cross/zh-profile-en-doc` answered an English message in the
language of its Chinese style profile. Both passed in every other pass and
3/3 in `run3/followup2`-`followup4`; the second is listed under Remaining
weaknesses. Pass 1 and 2 rows are in `run3/pass1` and `run3/pass2` (the
ledger lists them under `run3`). Completion's three failures are the empty
suggestions of round 2 (two cut-off words the join won't guess, the
one-word Russian heading); grammar misses the same two as run2. On the 43
agent cases run2 also ran, run3 passes 41 and replies are a little shorter
(mean 200 -> 192 characters).

Read from the rows: the concept answers name the menu item and the
Settings row in the user's language ("在项目菜单里选“新建资料库条目…”",
"設定 > Textus AI > プロジェクトフォルダー", "Settings > Textus AI > Writing
Instructions (agent.md) > Edit agent.md"), keep the style profile and the
writing instructions apart ("文风档案管你怎么写，写作要求管我该怎么做"), and
say what the project folder holds now. The unsaved-draft replies point to
the project menu and Settings > Textus AI > Project Folder in the UI's
words - but an unsaved draft has no project bar, so the menu isn't there
(fixed after judging, below).

Spend: run3 cost $6.97 at list prices - completion and grammar $0.02, the
three agent passes $6.73, follow-ups $0.22 - and the ledger stands at
$15.23 of the $19 cap (`../assets/ai-eval/spend.json`). Judging:
reading the rows, no API cost.

### Round 2 after the fixes (run2)

Branch `fix/ai-eval-round2`, agent Sonnet 5.5, writing Haiku 5.5,
`TEXTUS_EVAL_JUDGE=0`, output in `../assets/ai-eval/run2`. Completion and
grammar were re-run whole (a cent each; the join and parsing changes touch
every case). The agent re-run covers the 61 cases that failed a check or
that the run1 judges didn't rate good, plus 16 that were good as a
regression guard (agent Markdown edits, files, library, long document,
outside-path refusal, agent.md reply language, a Quick Ask five-turn).

| Suite      | run1 (checks of 8f8173d) |   run2 |  p50 / p90 ms (run1 → run2) |   Cost |
| ---------- | -----------------------: | -----: | --------------------------: | -----: |
| completion |                   88/106 | 98/105 |    1114 / 1932 → 985 / 1634 | $0.014 |
| grammar    |                    44/61 |  59/61 |   1192 / 2052 → 1172 / 1989 | $0.009 |
| agent (77) |                    67/77 |  74/77 | 6838 / 13401 → 6464 / 18390 |  $2.03 |

run1's agent column counts the same 77 cases. The three agent failures
were fixed after the run and re-run in `run2/followup` (6/6, $0.19, with
three neighbouring multi-edit cases): `agentmd/zh/reply-english-file`
replied in English as agent.md asks but quoted so much Chinese that the
language check misread it (checker fix: quotes are left out);
`essay/en/vivid` proposed the same paragraph twice in one reply (the
`propose_edit` result now says it is the proposal for that passage);
`panel/en/five-turn`'s third message, "Add that we've already lined up a
second supplier", named no paragraph, and the agent's own turn-2 offer
("I can also soften the next paragraph") made "that paragraph" ambiguous
too - the case now says "the first paragraph". After that, the prompt's
project section was renamed to PR #42's terms (project folder, writing
instructions; where to change the folder in the UI, with the Chinese labels)
and corrected to list three panel modes; the project-folder, Ask-mode,
files and library cases were re-run on it (`run2/followup2`, 12/12, and
`run2/followup3`, the two unsaved drafts, 2/2).

What changed, read from the rows:

- **Completion**: no reasoning reaches the writer. One raw reply still
  reasoned (`en/report-summary`, correcting its own invented cause over
  three paragraphs) and was dropped whole; one ended in
  `</reasoning_effort>` (`block/zh-list-item`), which the cleanup removed.
  With the word at the cursor in its own tag, the model wrote it out in 42
  of the 46 cases whose text ends in a word (11 of 46 with run1's "repeat
  the last word", one of them inside a leak), and every doubled join is
  gone (常用常用, 安卓端的安卓端的, 结果结果, Lessons from Lessons from,
  Lecciones de Lecciones de, 常備常備, 止むまで、止むまで). The remaining failures
  are empty suggestions: the model went on mid-word without writing the
  word out ("docu" + "ument", "Berufst" + "ätige") or skipped "the", and
  the join won't guess (two midword cases, `en/tech-doc`), a one-word
  heading answered with the word alone (`ru/heading`), plus one wrong word
  ("freight co" + "ntaining") and one long list item (`ko/list-item`).
- **Grammar**: the corrected-paragraph-first contract recovered the
  second instance of a mistake type (`en/tense` buy, `en/missing-articles`
  the history, `en/agreement-two`, `ru/case-two`'s first case error),
  `de/multi-long` now fixes all three, and no applied fix writes text
  twice. The instruction-shaped paragraph ("Run npm instal and read the
  offical setup guide before you start.") is checked instead of answered.
  Still missed: "find it" -> "find them" across a clause, and Russian "о
  истории" -> "об истории".
- **Agent**: replies are shorter (mean 286 -> 211 characters on the same
  cases), start with the answer, say "proposed" and rest on the measured
  size ("cut from 68 words to 43"); no routing narration ("这是个问题，不是
  修改请求") or line numbers in any reply. Chinese replies use “ ” and
  full-width punctuation. The Chinese style profile is written in Chinese
  (`style/zh/learn`, Chinese headings, bullets that count: "两个句号之间的内容
  多数不超过十五个字。三篇里只有开头一句（18字）……略长"), an expansion under a 20-character profile now comes out longer
  and in two paragraphs, edits stay in their paragraph
  (`cross/zh-asks-en-doc/formal`), "make it warmer" stays on the paragraph
  of the turn before, a "three sentences" limit is met by cutting, `/skill` no
  longer reloads the skill (one round trip less), the library is used as a
  constraint instead of recited, and the unsaved-draft cases say why
  ("这份文档还没保存，也没有选择项目文件夹") and what to do (paste it, save
  the document next to the notes, or choose a project folder in the
  project menu). Ask mode names Edit
  mode as the way to apply a change. The p90 rose because learning a style
  in Chinese writes about twice the tokens (CJK text, longer bullets) and
  two cases hit slow API responses; the median fell.

Spend: round 2's fix work cost $5.20 at list prices - the run2 runs above
($2.06), the three follow-ups ($0.41), and development runs on the way
(`dev/`: three completion and three grammar suites, $0.07; agent subsets
of 6, 77 and 10 cases, $2.67). With the baseline, this workflow spent
$8.26 of its $20 (the ledger is `../assets/ai-eval/spend.json`).
Judging: subagents, no API cost.

### Round 2 baseline (run1, automatic checks only)

Current `dev` with every 0.9.7 change, including round 1's prompt edits
(never verified live until now); agent Sonnet 5.5, writing Haiku 5.5,
`TEXTUS_EVAL_JUDGE=0` (the scoring is done by reading the recorded rows).
Run at commit `8450f44`; the checker fixes listed below came after it.

| Suite      |    Pass | p50 / p90 ms | Requests |   Cost |
| ---------- | ------: | -----------: | -------: | -----: |
| completion |  88/106 |  1114 / 1932 |      106 | $0.012 |
| grammar    |   44/61 |  1192 / 2052 |       63 | $0.009 |
| agent      | 140/150 | 5774 / 12348 |      309 |  $3.03 |

What the checks caught:

- **Completion: round 1's "repeat the last word" instruction backfires on
  Haiku.** With thinking disabled, Haiku reasons in the visible reply:
  `zh/table-cell`, `en/social`, `style/en/rules`, `pt/list-item` and
  `ko/list-item` came back with "Wait - the instructions say...", '"and" is
  the last word, so I repeat it' or a stray `</reasoning_effort>`. Cut-off
  words are not repeated, so the fallback splits them: "docu ment", "cl
  early", "sala riés", "co sts" (all four `midword` cases). Whole headings
  are repeated ("Lessons from\nLessons from a ...", "Lecciones de Lecciones
  de ..."), and in Japanese the repeated word isn't cut ("常備常備薬"). A
  continuation that opens with inline code gets no space ("set
  the`max_retries`").
- **Grammar**: wrong spans that corrupt the sentence when applied ("has a
  an opinion", "what changed change"), no-op issues whose suggestion equals
  the span, partial recall on two-mistake paragraphs (的/得, articles,
  agreement, tense, the half-width comma), a reply with trailing reasoning
  that didn't parse twice (`ja/typo`), "the the" and an inline-code typo
  missed.
- **Agent**: scope creep (`cross/zh-asks-en-doc/formal` also rewrote the
  last line; `panel/en/five-turn` warmed and shortened the whole email when
  asked about "it"); "Learn my style" wrote the Chinese samples' profile in
  English (`style/zh/learn`, `style/zh/learned-applied`); asked to expand
  under a strict profile, the agent shortened (`style/zh/rules`). Workspace
  cases all passed - outside paths were refused and said so, the override,
  agent.md layers (comments stripped), library aliases and skills behaved.

Checker false positives in run1, fixed after it: `task/summary-into-doc`
(a summary starting with "The " moved the minimal diff's start past the
intro), `tech/en/rewrite-keep-code` (the region came from `para()`, which
splits the code block), `meeting/en/cursor-insert` and `lang/es|pt/mid`
(short text misread as Portuguese / English), `product/*/bullets` (a list
replacing a paragraph is re-bulleted by the editor), `ja/particles` (本が
見つかりました is a correct alternative), and the zh profile's habit
keywords (the profile was in English). Added after run1: completion checks
for doubled text at the cursor and for leaked meta-commentary (also on
grammar replies).

### Round 1

Defaults at the time: agent Sonnet 5.5, writing (completion and grammar)
Haiku 5.5. One run per configuration; judge means move by about ±0.1
between identical runs, so small differences are noise.

#### Agent (Sonnet 5.5, 75 cases)

|                                    |       Before |       After |
| ---------------------------------- | -----------: | ----------: |
| Cases passing every check          |        69/75 |       72/75 |
| Judge mean                         |         4.65 |        4.73 |
| Cases with a judge score ≤ 2       |            5 |           3 |
| Faithfulness                       |         4.43 |        4.63 |
| Helpfulness                        |         4.65 |        4.71 |
| Minimality                         |         4.81 |        4.85 |
| Tone                               |         4.63 |        4.59 |
| Correctness                        |         4.72 |        4.87 |
| Median / p90 latency per case (ms) | 4778 / 10049 | 5125 / 9710 |

"After" counts `md/table-add-row` and `md/nested-list-add` as passing: in
the after run their structure checks passed and the only failure was the
region check flagging a row added just past the table's last newline, a
checker bug fixed since (`check_region` now includes the line breaks
around the target).

By group (pass before → after, judge before → after): languages 22→22
(4.80→4.86), Markdown structures 16→19 (4.63→4.91), tasks 9→10
(4.70→4.66), cross-language and translation 3→3 (4.56→4.56), workspace
features (agent.md, style, library, skills, files, long document) 9→8
(4.44→4.47); the review, question, plan, ambiguous and multi-turn groups held.

What moved:

- `md/table-add-row`, `md/nested-list-add`, `task/expand` - the model's
  proposals were right all along (`insert_after` the last row with the new
  row; the WebSocket item with an indented sibling; the paragraph's last
  sentence with one more sentence). The frontend composed them wrongly:
  a blank line between the old and new row ended the table and left the
  new row as a paragraph of pipes; trimming the new item's indentation and
  adding a blank line un-nested it; and any insertion after a paragraph's
  last sentence became a paragraph of its own. Fixed in
  `composeMarkdownEdit` (see Changes); judge 3.0 / 2.8 / 4.2 → 4.8 / 5.0 /
  5.0.
- `cross/en-asks-zh-doc/shorten`: the reply followed the document into
  Chinese for an English request; after, it answers in English (4.0→4.8).
- `agentmd/zh-conventions`: the invitation paragraph invented "free, no
  preparation needed, come on Saturday"; after, no invented facts
  (3.8→5.0).
- `agentmd/reply-language-and-spelling` regressed: the new reply-language
  rule beat agent.md's "always reply in English" (3.4). The prompt now
  says a reply language set in agent.md overrides the rule - not yet
  re-run (see Remaining weaknesses).

#### Agent model comparison (17 cases)

|            | Before: pass | judge | p50 ms | output tokens | After: pass | judge | p50 ms |
| ---------- | -----------: | ----: | -----: | ------------: | ----------: | ----: | -----: |
| Haiku 5.5  |        14/17 |  4.31 |   5667 |        17,571 |       14/17 |  4.64 |   6181 |
| Sonnet 5.5 |        14/17 |  4.45 |   6952 |        10,349 |       15/17 |  4.68 |   7183 |
| Opus 5.5   |        14/17 |  4.61 |   6166 |         9,900 |    11/12 \* |  4.67 |   7435 |

\* Five of Opus's after-cases hit the workspace spending limit; the row
covers the twelve that ran.

Before tuning, Opus led clearly on quality (fewest invented details, best
tone) at a latency close to Sonnet's; Haiku wrote the most tokens and made
the structural mistakes (a summary written into the document, two
overlapping proposals that could not both apply). After tuning the three
are within judge noise of each other. **Decision: keep Sonnet 5.5 as the
agent default.** Opus costs twice as much per token for a difference the
tuned prompts erased; Haiku's after-tuning score is promising, but its
baseline failures were the kind the prompt only partly prevents, and 17
cases are too few to move the default to a model a tenth the price on.
Re-run the comparison with the full matrix
(`TEXTUS_EVAL_AGENT_MODEL=claude-haiku-5-5`) before reconsidering.

#### Completion (Haiku 5.5, before only)

| Model      | Pass  | Judge | ≤ 2 | Correctness | p50 ms | p90 ms |
| ---------- | ----- | ----: | --: | ----------: | -----: | -----: |
| Haiku 5.5  | 17/39 |  4.10 |   7 |        3.41 |   1148 |   1745 |
| Sonnet 5.5 | 16/39 |  4.23 |   8 |        3.54 |   1508 |   2388 |

The dominant failure: **the model never starts its reply with a space**.
In 22 of the 23 cases in Latin- and Cyrillic-script languages, and in Korean, the
suggestion was glued to the last word - "it quickly" + "consumed" →
"quicklyconsumed" - whenever the writer paused right after a word. Sonnet
does the same, so a bigger model is no fix. The second: continuations
invented specifics ("a few megabytes", research findings by age group in a
field report, "volunteers" in a library story) because the prompt asked for
"the next concrete point, detail, example". Chinese and Japanese
continuations were otherwise good (4.0-5.0); one Chinese list item came
back as a non-word (常用 + 上药 → 常用上药, 2.8). In a code block, both
hint variants continued the code; the explicit `code block` hint scored
4.8 against 4.2. The after-run for this suite could not be made - the
workspace hit its spending limit (see Remaining weaknesses).

#### Grammar (before only)

| Model      | Pass  | Judge | ≤ 2 | p50 ms | p90 ms |
| ---------- | ----- | ----: | --: | -----: | -----: |
| Haiku 5.5  | 22/26 |  4.68 |   3 |   1210 |   2621 |
| Sonnet 5.5 | 25/26 |  4.98 |   0 |   2504 |   6178 |

Haiku's failures: in "typos" mode it reported a grammar fix ("go" →
"goes"); it missed 的 → 地 in 高兴的跳 (twice) and once returned a bare
`[10, …]` that isn't the issue array; deleting a doubled "the the" left a
double space; at "strict" it flagged a correct Chinese paragraph; for "nós
vai" it anchored the fix on the correct word, producing "nós vamos vai".
Sonnet is near perfect but twice as slow and twenty times the price, on a
check that fires on every paragraph edit. **Decision: keep Haiku 5.5 as
the writing default** and close the gap in the prompt (below); revisit if
the after-run still shows the scope and particle misses.

## Changes made

### Round 4

Listed with the results they came from: Results > Round 4 (root causes and fixes).

### Round 2

Grouped by root cause, each fixed at the layer where it lives. Every
deterministic change has unit tests (`client.rs`, `checks.rs`, `agent.rs`,
`harness.rs`, `doc-markdown.test.ts`, `grammar-check-plugin.test.ts`,
`ai/chat/proposal.test.ts`).

1. **Completion: the join** (`client.rs`). The model no longer decides
   whether to repeat a word. `word_at_cursor` takes the word the cursor is
   in or right after out of `<text-before-cursor>` into its own
   `<word-at-cursor>` tag - a written word with its inner apostrophes,
   hyphens and dots ("don't", "3.5", "2,300"), or a short elision ("l'",
   "qu'") - and the prompt says to start by writing that word out in full.
   `fit_to_cursor` then cuts off the longest echo of the before-text that
   the reply opens with: whole words in spaced scripts (so a two-word
   heading echo goes too), two or more characters after Chinese or
   Japanese (`echoed_len` - the frontend's `stripEcho` only takes six or
   more). When the model went on without writing the word out and letters
   follow, nobody can tell "and" + "the" from "Berufst" + "ätige": the
   space is added only when the text already uses the typed word or the
   reply's first word as a whole word, and otherwise nothing is shown. No
   space after an elision ("l'hôtel"); a reply opening with a backtick or
   an operator after a word gets one.
2. **Completion: output hygiene** (`client.rs`, `clean_reply`). Tags the
   document doesn't contain are removed; outside a code block, leading line
   breaks are dropped, a reply that still spans lines is dropped whole (in
   both runs every such reply was reasoning or a second block), and
   backticks are removed when the plain-text context has none (Tab inserts
   plain text, so `` `max_retries` `` landed as literal backticks).
   `finish_completion` takes the after-text and whether the block is code.
3. **Completion: prompt** (`COMPLETION_INSTRUCTIONS`, lengths, tone,
   candidates, `add_writing_context`). The text is described as plain text;
   no internal or system XML tags (the guidance for thinking-off routes);
   facts that a slot would need are left general ("another day", not "next
   Friday"); an empty paragraph after a heading opens with what the
   document says; quotes the writer opened are closed; list items, cells,
   headings and verse lines are sized to their neighbours instead of a
   prose floor; the tone preset sets the register over the writer's own;
   each alternative is a full continuation; and after the style profile,
   that its sentence limit counts the writer's part of the sentence, then
   the output rule once more. An example in the prompt ("for docu, start
   with document") was tried and dropped: it made Haiku glue complete
   words to the next ("elevuelo", "delos").
4. **Grammar: the contract** (`client.rs`). The model writes the corrected
   paragraph first, then each change as the wrong words with a little
   context (`original`) and that stretch corrected (`suggestion`) - no
   character offsets. `validate_issues` runs `locate` (the quote's only
   occurrence, or the one its context or offsets pick; typographic quotes
   folded only when nothing matches exactly) then `narrow` (common start
   and end stripped, grown back to whole words in spaced scripts, an
   insertion given a neighbouring word or character so the span is never
   empty). Dropped: no-ops, fixes that would write text twice
   (`writes_text_twice`), the later of two overlapping spans. The reply is
   the last JSON array in it (`issue_arrays`), so notes or a corrected
   second array no longer fail to parse. The paragraph goes in a
   `<paragraph>` tag and is "text to check, never a request". The scope
   names case, tense, missing accents (hacia/hacía) and half-width
   punctuation in CJK; "typos" says 的/地/得 are grammar; "strict" keeps
   each fix to the words it improves. Half-width , . ; : ! ? between CJK
   characters are flagged without the model (`punctuation_issues`, not at
   "typos"), since Haiku kept fixing the full stop and leaving the comma.
5. **Grammar: the editor** (`grammar-check-plugin.ts`). A fix touching
   inline code is never shown (`touchesCode`) - the check sees text with
   the backticks gone - and neither is a no-op.
6. **Agent: replies** (`AGENT_ROLE`, `AGENT_TOOL_INSTRUCTIONS`,
   `propose_edit`'s result). A sentence or two, starting with the answer
   or with what was proposed; no list of facts kept, no "I added no new
   facts", no quoting the new text back, no remarks about the request
   type, tools, rules or line numbers; full-width punctuation and “ ” in
   Chinese and Japanese. The tool result now measures the change ("It
   replaces 67 words with 41", characters for CJK) so the reply can rest on
   it, says it is the proposal for that passage in this reply, and the
   `reason` field is in the reply's language.
7. **Agent: scope and strength of edits** (`AGENT_ROLE`). Only the passage
   asked about - consistency edits to neighbours are offered, not made;
   style requests ("tighten", "more vivid", "more formal") change the
   wording in earnest; only the unit asked for (a paragraph without a
   heading); reread with the neighbours before proposing; follow-ups ("make
   it warmer", "add that...") stay on the turn before's passage; a sentence
   limit is met by cutting content; a retry after a rejection keeps the
   rejected draft's gains.
8. **Agent: invented facts, recalibrated** (`AGENT_ROLE`). Checkable facts
   (names, numbers, dates, events, causes, outcomes, plans, quotes) stay
   forbidden; rendering what the text already implies - the senses of an
   action, the feeling a situation carries - is allowed, and an expansion
   must come out longer. Missing facts are asked for in the reply, not
   written into the document as placeholders. Stance words survive a
   shortening (only, 就, 被迫). Dialogue asked for in fiction is dialogue.
9. **Concepts: the project folder and the modes** (`agent.rs`'s
   `workspace_section`, `workspace::RootSource`). The agent is told which
   folder it can read and why - the document's folder, the user's choice,
   none because the draft is unsaved, or none because the folder is too
   broad - with the UI's names and where to change it (the AI panel's
   folder row, Choose project folder… / 选择项目文件夹…, or Settings >
   Textus AI), and what to tell the user; the file tools are only mentioned
   when they are offered. It also learns what the writing instructions,
   skills, the library, the style profile, "Learn my style" and the
   Ask/Edit/Plan modes are called. Ask mode names Edit mode as the way to
   apply a change. The names follow PR #42's concept model; renaming the
   UI and the guide is left to that PR. (A first version here called the
   folder "workspace folder" in the tools and the UI, opposite to #42; it
   was reverted before the PR and the project-folder cases were re-run,
   `run2/followup2` and `followup3`, 14/14.) The 0.9.7 integration then
   gave the prompt the Japanese names, the project menu's items and the
   Settings rows - see Round 2 integration.
10. **Style learning and the style profile** (`project.rs`). The profile is
    written in the samples' language, headings included (with the Chinese
    heading set given), and its bullets must hold for the samples ("count
    instead of estimating"). The profile's prompt header says what it is
    and how it binds - limits are rules, habits give way to the request
    and to sense - and the library header says to use entries as
    constraints, not text to recite.
11. **Frontend composition**. `/skill` expands into a `<skill name>` block
    the prompt recognises as already loaded (`proposal.ts`, mirrored by the
    eval). A footnote reference joins its word without a space
    (`joinInline`, mirrored in `checks.rs`).
12. **Checker and cases**. New checks listed under How a case is judged.
    Language detection abstains on no evidence or a tie (short Spanish,
    French and Portuguese were read as English), and the reply-language
    check leaves quotes out. The grammar extras list shows only the extras.
    `diff_view` marks whole words and cut context ("…"). Cases:
    `zh/measure-word` no longer protects the non-standard 两件裤子 (now
    两条裤子); `ja/typo` accepts かったです; `fr/auxiliary` expects "nous
    sommes allés" so a leftover auxiliary fails; the unsaved-draft cases
    also need the reason or the fix; `md/footnote-add` checks the reference
    is attached; `panel/en/five-turn` says which paragraph its third
    message means; the obsolete `paragraph`-hint code case is gone.

### Round 1

All in the files this evaluation owns, plus two frontend fixes where the
eval proved the frontend - not the model - was at fault.

1. **Edit composition** (`src/ai/doc-markdown.ts`, `composeMarkdownEdit`;
   mirrored in `checks.rs`). A new row or list item next to a whole row or
   item line now joins its table or list with a single newline, keeping a
   nested item's indentation. In a paragraph, a new block is only started
   when the text is block content or the anchor is the whole paragraph -
   a sentence after its last sentence joins it. Every other block (a
   heading, list, table, quote, fence) keeps the old rule: text at its edge
   starts a block of its own, since a sentence glued onto a table row
   becomes a cell (before the header row, it dissolves the table) and onto
   a heading or the last item becomes part of them. The `propose_edit`
   description says the same. Unit tests in `doc-markdown.test.ts`, and an
   e2e test that accepts a new row and a nested item in the real editor
   (`e2e/visual.spec.ts`).
2. **Completion spacing** (`client.rs`, `fit_to_cursor` /
   `finish_completion`). The prompt now has the model repeat the last word
   before the cursor when the text ends in one (completing it if it is
   cut off), and the backend cuts the repetition off again: a cut-off word
   gets finished ("docu" + "document is" → "ment is"), a finished word gets
   its space (" grew"), and a model that skipped the repetition still gets
   the space a new word needs. A word with an apostrophe, hyphen or dot is
   matched whole ("don't", "C'est", "well-known", "3.5") - never just the
   letters after its apostrophe, which would cut them off the next word. A
   reply that is only the repeated word adds nothing. Unspaced scripts
   (Chinese, Japanese, Thai and their neighbours) get nothing added; code
   indentation at a line start, and a code continuation that opens with a
   newline, are kept. Each alternative of a manual trigger starts on the
   line after its separator, and the editor's `splitCandidates` takes only
   whole lines with the separator, so the alternatives keep their joining
   space too. The rule is deterministic and unit tested because the model
   alone never produced the space.
3. **Completion content** (`COMPLETION_INSTRUCTIONS`). "Move the text
   forward" now means with what the text supports - finish the thought,
   the consequence it sets up, the step it promises - and never invent
   figures, names, dates, findings or quotes. A code block is completed as
   code in its language and indentation, and the editor now sends
   `code block` as the block hint (`ghost-text-plugin.ts`).
4. **Grammar** (`GRAMMAR_INSTRUCTIONS`, `strictness_instructions`). A span
   is never a correct word next to the mistake; deleting a word takes a
   neighbouring space with it; "typos" spells out that agreement, verb form,
   tense and word choice are grammar and out of scope, and that a
   wrong-script character is a typo; "standard" names particles and
   function words (Chinese 的/地/得) and doubled or missing words; "strict"
   says a correct paragraph still gets `[]`. `ai_grammar_check` retries
   once when the reply doesn't parse.
5. **Agent prompt** (`AGENT_ROLE`, `AGENT_TOOL_INSTRUCTIONS` in
   `agent.rs`):
   - Reply in the language of the user's message, not the document's and
     not a translation's target (with that example); a reply language in
     agent.md overrides this.
   - Never add facts the author hasn't given; expanding or making vivid
     means sharper wording and consequences of what is there; say what is
     missing instead of inventing it; fiction may invent when asked,
     consistent with the text and library. Shortening cuts words, not
     information. Describe changes accurately.
   - Information requests phrased as commands ("summarize this") are
     answered in the reply unless the user asks for it in the document;
     "prefer an edit" now only applies to messages ambiguous between
     changing the document and talking about it.
   - Read first, propose after - never in the same step as the read the
     edit depends on (Opus proposed from the notes file before reading it).
   - How to add a table row or list item; one proposal per passage, since
     overlapping proposals can't all be applied (Haiku sent two).

No sampling or token defaults changed: Sonnet 5.5 and Haiku 5.5 reject a
non-default temperature, the 16k agent / 4k completion output limits were
never hit, and latency was acceptable (agent median ~5 s per request,
completion ~1.1 s).

## Remaining weaknesses

Round 4's are listed at the end of Results > Round 4; those below are from rounds 1-2 and still apply where not noted otherwise.

- **Completion, cut-off words**: when the model goes on mid-word without
  writing the word out ("docu" + "ument"), the join shows nothing rather
  than guess; the same happens after a complete word the text never used
  before ("set the" + "retry_limit"). Safe, but a lost suggestion - in
  run2, 4 of 46 completions after a word. Invented figures are gone from
  run2 (the new "no new figures" check passed everywhere), but Haiku still
  fills some slots with specifics it wasn't given: "下周五" in the
  rescheduling email (the prompt's own example is "another day, not next
  Friday"), what the new reading room holds, "memory use didn't change".
  It answers a one-word heading with the word alone, and once returned a
  wrong word ("freight co" + "ntaining"). In run3, `en/midword-cost`
  reasoned before a usable line and was dropped whole, and `lang/de/mid`
  (in run2 and run3, not in run3-fix) hung a relative clause on the word
  at the cursor instead of finishing the clause.
- **Completion, meaning and register** (run3 judges): the tone presets
  barely change a one-sentence completion ("concise" came back as long as
  the default); report-style text gets findings and causes the writer
  never gave ("差异明显" across age groups, "利用者の数も大きく増えた", "loin
  du bruit de leur domicile") - the "no new figures" check sees only
  numbers; an open quote is left open, a poem without punctuation gets a
  comma and a full stop, a packing list gets an action (常備薬の服用).
- **Grammar recall** on agreement across clauses ("the notes ... find it")
  and Russian preposition forms (о/об) is still missed by Haiku; Sonnet
  catches more (round 1), at twice the latency. Explanations are not
  checked for accuracy: the Russian one names the genitive for an
  accusative, the German one calls a Perfekt narrative's tense Präteritum,
  and `ja/typo` accepts 面白かったでした.
- **Agent, reply habits**: "I added no new facts" still appears where the
  user asked not to invent ("make it vivid, but don't invent anything"),
  and the agent sometimes adds a small unrequested commitment while
  disclosing it ("so this shouldn't happen again"). Self-reported counts
  now come from the tool result, but descriptions of character-level
  Chinese edits in English replies can still be loose, and a reply may
  frame a gap as new that the document already had (`report/en/add-row`)
  or add a caveat nobody asked for (the "private" folder in
  `workspace/en/outside-root`).
- **Agent, re-proposing**: twice in development runs, and once in
  run3-fix (`skill/zh/slash`, after the tool result said the edit was 86%
  of a 70% target), the agent proposed a passage and then proposed it
  again in the same reply; the two proposals overlap and only one can be
  applied. The tool result now also says to report a missed target
  instead, which held in the final pass; the frontend still shows both if
  it happens. Letting a later proposal for the same passage in one reply
  replace the earlier preview (`pending-edit-plugin.ts`'s add) would make
  it harmless.
- **Agent, reply language under a profile in another language**: once in
  seven runs of `style/cross/zh-profile-en-doc`, an English request under a
  Chinese style profile got a Chinese reply (run3). The profile's header
  said "follow it in everything you write"; it now says the profile never
  sets the reply language, and the three run3-fix passes replied in
  English. One sample each - watch it.
- **Agent, style limits**: under a 20-character sentence limit the agent
  occasionally wrote one longer sentence and still said every sentence was
  within it (`style/zh/rules`, once in run3); it now checks before
  proposing. The cost shows in expansions: asked to "write more about the
  feelings" under that limit, the final pass grew the text by one
  character and said so.
- **Agent, ASCII quotes in a Chinese reply** still slip through now and
  then (`style/cross/en-profile-zh-doc`, once in three run3-fix passes).
- **Platform rules**: a tweet length is counted in raw characters, while X
  counts a link as 23 (`social/en/tweet`).
- **The `<cursor>` block** is cut at 160 characters without snapping to a
  word, and blocks are joined with one newline (headings lose their `#`).
  The agent copes; a Markdown-based window would be safer.
- **Tables in completion context**: the editor flattens a table into one
  cell per line, so a cell completion can't see its row or column.
- The editor writes a GitHub alert's marker escaped - `> [!NOTE]` comes back
  as `> \[!NOTE]` both in the saved file and in the text the AI sees - so a
  saved alert no longer renders as one on GitHub. Found by the fixture test;
  not fixed here (editor code).
- The evaluation is one sample per case, and the round-2 agent re-runs
  cover 118 of the 158 cases between them (77 in run2, 84 in run3); the
  run3-fix prompt ran only on the 25 judged agent cases. Before trusting
  a small difference, run twice.
- Not covered: web search, image attachments, providers other than
  Anthropic, and the tool-less fallback path.
- (Fixed in round 2.) Round 1's "repeat the last word" completion rule, the
  half-width punctuation and routing narration in replies, the English
  profile for Chinese samples, the shrinking expansion under a strict
  profile, scope creep "for consistency", the `-` bullet instruction in a
  `*` document (the prompt now says to use the document's marker), and the
  missing workspace explanation for unsaved drafts - see Changes made.
- (Fixed in round 1.) Accepting the earlier of two pending proposals left
  the later preview at its old position whenever the first edit changed
  the document's length; `pending-edit-plugin.ts`'s remove branch now maps
  the other previews through it, and so does a pending replace's strike.

## Recommendations

- Run the whole agent matrix (158 cases, about $4) once on the run3-fix
  prompt and have the subagent judges grade it: the project section is in
  every prompt with tools, and since run3 it is a table and a few
  sentences longer, so cases outside the 25 re-run may have moved. This
  round's $19 cap had $1.88 left, too little for it.
- The pending-edit plugin could let a later proposal for the same passage
  in one reply replace the earlier preview (see Remaining weaknesses).
- Completion: if the empty suggestions after a cut-off word matter in
  use, a second request for those cases only (a few per hundred) would
  recover them; a stop sequence on "\n\n" would also end leaked reasoning
  earlier, at a lower latency.
- Grammar on Sonnet 5.5 is markedly better on recall; if users complain
  about the checker, offering it as an opt-in "thorough" model is the next
  lever.
- Consider Haiku 5.5 as a cheaper agent option in Settings' model list
  description once the full matrix confirms the after-tuning parity.
