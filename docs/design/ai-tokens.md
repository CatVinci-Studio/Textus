# AI token use

What each kind of AI request sends, what the provider caches, where tokens
go to waste, and a ranked plan for spending fewer of them without making the
answers worse. Measured on 2026-10-19 against `main` at f3e44892 (1.2.0-rc.2).

## How it was measured

`src-tauri/src/ai/live_eval/tokens.rs` holds three ignored tests, run from
`src-tauri/`:

```sh
cargo test --lib live_eval::tokens -- --ignored --nocapture --test-threads=1
```

- `live_token_breakdown` counts every part of a request with Anthropic's
  `count_tokens` endpoint, which is free and exact for Claude. Sections are
  counted as the difference between a request with and without them.
- `live_token_usage` runs six real conversations on Sonnet 5.5 through the
  app's prompts, tools and loop (`harness::run_conversation`) and prints the
  `usage` of every step: uncached input, cache write, cache read, output.
  About $0.21 a run.
- `live_doubao_prefix_cache` sends the same agent prompt to Volcengine Ark
  three times to see whether its chat completions cache a prefix.

Token counts below are Claude's (Sonnet 5.5 for the agent, Haiku 5.5 for
completion and grammar). English prompt text runs about 3.1 characters a
token; Chinese text about 1 character a token. Other providers' tokenizers
differ: Doubao counted the same Review-mode request as 6,461 tokens where
Claude counts 8,437 plus the message.

## What a request sends

### The agent's fixed prefix

Tools and the system prompt come first in every agent request and are the
same for every message of a conversation, and for every conversation in the
same project folder and mode (`build_instructions`, `tools::builtin_tools`).

| Setup                               | System prompt |      Tools | Together |
| ----------------------------------- | ------------: | ---------: | -------: |
| Unsaved draft, Write                |         7,890 |  2,785 (7) |   10,675 |
| Unsaved draft, Review               |         6,397 |  2,040 (6) |    8,437 |
| Unsaved draft, Revise               |         7,706 |  2,864 (7) |   10,570 |
| Unsaved draft, Revise, Chinese UI   |         8,575 |  2,864 (7) |   11,439 |
| Project folder, Revise              |         7,841 | 3,841 (12) |   11,682 |
| Project folder, Revise, remember on |         7,841 | 4,318 (13) |   12,159 |

The system prompt by section (project folder, Revise, English):

| Section                                                            | Tokens | Characters |
| ------------------------------------------------------------------ | -----: | ---------: |
| `AGENT_ROLE` (language, replies, editing, facts, style)            |  2,281 |      7,519 |
| Interaction mode                                                   |     73 |        245 |
| `AGENT_TOOL_INSTRUCTIONS` (propose_edit rules)                     |  1,429 |      4,781 |
| `RULES_TOOL_INSTRUCTIONS`                                          |    292 |        972 |
| `workspace_section` (project folder, app concepts, how-to answers) |  1,302 |      4,260 |
| Skill index (15 built-in skills: 2,228 of it)                      |  2,464 |      6,740 |

Each tool's marginal cost (description plus schema):

| Tool                    |                                           Tokens |
| ----------------------- | -----------------------------------------------: |
| propose_edit            | 824 (Write mode's insertion-only version: 1,031) |
| measure_text            |                                              511 |
| remember                |                                              477 |
| check_conventions       |                                              451 |
| add_comment             |                                              277 |
| read_file               |                                              264 |
| read_document           |                                              240 |
| find_files              |                                              236 |
| search_files            |                                              179 |
| use_skill               |                                              170 |
| list_files              |                                              152 |
| view_image              |                                              146 |
| search_document         |                                              105 |
| Fixed tool-use overhead |                                              286 |

### The message being sent

The current message carries the style profile, the library entries it
mentions and the document (`request_context`), then the user's text. History
keeps only the user's text, so the document is sent once per message, never
replayed.

| Document                                    | Characters | Message tokens |
| ------------------------------------------- | ---------: | -------------: |
| Short English report                        |        811 |            281 |
| English, 39,000 chars (embedded whole)      |     39,000 |         12,742 |
| English, 106,000 chars (outline + excerpts) |    106,467 |          1,548 |
| Chinese, 20,000 chars (embedded whole)      |     20,000 |         20,464 |
| Chinese, 42,600 chars (outline + excerpts)  |     42,648 |          4,428 |

`FULL_DOCUMENT_LIMIT` counts characters (40,000), so a Chinese document can
be three times as many tokens as an English one before it is cut: a 39,000
character Chinese chapter is about 40,000 tokens in every message.

Attachments with text (PDF, Word, spreadsheets) are inlined into the message
up to 60,000 characters (`commands/attachment.rs`) and, unlike the document,
stay in history, so every later message replays them.

### Completion and grammar

| Request           | Total | System prompt |                              User text |
| ----------------- | ----: | ------------: | -------------------------------------: |
| Inline completion | 1,343 |         1,195 | 148 (179 characters before the cursor) |
| Grammar check     | 1,195 |         1,085 |                    110 (one paragraph) |

Nine tenths of each is the same instructions every time.

## What one message costs, step by step

Sonnet 5.5, `live_token_usage`, one run. "Write" and "read" are cache writes
and reads; uncached input was 2-4 tokens a step and is left out.

| Run                         | Step |  Write |   Read | Output | Tool calls in the message                 |
| --------------------------- | ---- | -----: | -----: | -----: | ----------------------------------------- |
| Revise, short document      | 1.1  | 10,849 |      0 |    273 | propose_edit                              |
|                             | 1.2  |    425 | 10,849 |     78 |                                           |
|                             | 2.1  |    847 | 10,502 |    409 | propose_edit                              |
|                             | 2.2  |    561 | 11,349 |     73 |                                           |
| Review, a question          | 1.1  |  8,721 |      0 |     60 | none                                      |
| Write, add a paragraph      | 1.1  | 10,964 |      0 |    797 | propose_edit                              |
|                             | 1.2  |    945 | 10,964 |    105 |                                           |
| Quick Ask (Fast), two turns | 1.1  |    446 | 10,502 |    169 | propose_edit                              |
|                             | 1.2  |    309 | 10,948 |     81 |                                           |
|                             | 2.1  |    882 | 10,502 |    155 | propose_edit                              |
|                             | 2.2  |    295 | 11,384 |     98 |                                           |
| Revise, 106k-char document  | 1.1  |  1,630 | 10,502 |     96 | read_document (4,018 chars), propose_edit |
|                             | 1.2  |  3,790 | 12,132 |  1,012 |                                           |
|                             | 1.3  |  1,162 | 15,922 |     97 |                                           |
| Write, project folder       | 1.1  | 12,087 |      0 |     26 | list_files, read_file ×2, propose_edit    |
|                             | 1.2  |     66 | 12,087 |    105 |                                           |
|                             | 1.3  |    250 | 12,153 |    319 |                                           |
|                             | 1.4  |    465 | 12,403 |    159 |                                           |

18 requests: 54,694 tokens written, 162,199 read, 4,112 output, $0.21. Cache
writes were 65% of the bill, reads 15%, output 20%.

What the numbers show:

- Within a message every step reads everything the step before it sent,
  and from the second message on the first request reads the prefix
  (10,502) and the history. The breakpoints `anthropic.rs` places work as
  [ai-eval.md › Prompt caching](ai-eval.md#prompt-caching) describes.
- A new mode or project folder writes its whole prefix again (8.7k-12.1k
  tokens, $0.022-0.030 on Sonnet 5.5): the tool list differs per mode, and
  the system prompt per folder. Four of the six runs started cold, and those
  four writes were half the run's cost. Quick Ask's Fast thinking read the
  Revise prefix the panel had written: changing the thinking level kept it.
- Every message that proposes an edit spends a last request only to write
  the one-sentence reply after the propose_edit result (steps 1.2, 2.2, 1.3,
  1.4 above): 7 of the 18 requests, about 16% of the cost here, and a round
  trip of waiting each time.
- Output is small: replies are short and edits are the only long output.

Completion and grammar, before this change: every request was uncached
(1,312 and 1,165-1,194 input tokens, 0 read).

## Prompt caching, provider by provider

- **Anthropic.** Agent requests: tools + system (breakpoint on the last
  system block), two breakpoints in the history, the automatic one at the
  end. The prefix is byte-stable: no timestamps or ids, a fixed tool order,
  the document and library after the cached part, `compact_history` cutting
  the same way every time, the budget note added once to the result it
  follows. What still breaks it: switching to or from Review (another tool
  list), turning web search on or off (a server tool is added to the
  tools), a 5-minute pause (the cache's lifetime). Switching between Write
  and Revise and saving a memory no longer do (item 7, below). Single calls (completion, grammar, Learn my style)
  had no breakpoint at all: Haiku 5.5 caches from 512 tokens, and their
  instructions are 1,100. Fixed in this change.
- **OpenAI (Responses API).** Automatic prefix caching from 1,024 tokens;
  the request order (tools, instructions, history, the message with the
  document last) keeps the prefix stable. `store: false`, no
  `previous_response_id`. Nothing to change.
- **DeepSeek, Qwen, Kimi, Gemini and other chat-completions servers.**
  Automatic or implicit prefix caching on the server's side, which the same
  stable order serves. Their `usage` is read (item 10, below), so their
  cache hits show in each step's usage.
- **Doubao (Volcengine Ark).** Chat completions cached a prefix only now and
  then: 2 of 6 requests read 5,944 of 6,452-6,461 tokens, and an identical
  repeat read nothing in one of the two runs. Ark's own cache
  (`caching: {"type": "enabled"}` on the Responses API) answered
  `403 AccessDenied.CacheService`: it has to be turned on per account in the
  Ark console. In practice every Doubao step pays the full prefix.

## Waste, and a plan

Ranked by saving against risk. "Now" items are in this change; "Refactor"
items belong in the coming agent-layer refactor (one provider path,
cancellable tools, a runtime tool registry), because they change the loop,
the tool registry or the files the in-flight web-search, image-generation
and document-extraction PRs edit; "Later" items are separate small PRs once
those land.

| #   | What                                                                                                                                                                                                                                | Saving                                                                                                                                                 | Risk                                                                                                 | When                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | Cache the instructions of single calls (completion, grammar)                                                                                                                                                                        | Completion suite -44% ($0.0167 to $0.0093), grammar -49% ($0.0105 to $0.0054); in real typing, where the instructions repeat, about -80% of input cost | Low: prompt bytes unchanged                                                                          | Now                                                         |
| 2   | End the loop after a step whose only calls are successful propose_edit / add_comment and that already carries the reply text                                                                                                        | 1 request of about 2.2 per edit message: ~16% of agent cost on Anthropic, ~45% of input on providers without caching, a few seconds per edit           | Medium: the reply must come before the call; needs the full agent matrix                             | Refactor                                                    |
| 3   | Count the document limit and the history budget in token-like units (CJK ×3, as `read_file` already does)                                                                                                                           | A 13k-40k-character Chinese document: from up to ~40k tokens per message to the outline view (~4.4k); the same for long Chinese histories              | Medium: more read_document steps on mid-size Chinese documents; eval with the zh long-document cases | Later                                                       |
| 4   | Say each rule once: `AGENT_TOOL_INSTRUCTIONS` repeats most of propose_edit's description, and Write mode gets the Revise text (replace, delete) for actions it doesn't have                                                         | ~700-900 tokens a request                                                                                                                              | Medium: prompt change, full agent matrix                                                             | Refactor (each tool carries its own, per-mode instructions) |
| 5   | Shorter skill index: one line per skill, without the trigger words in eight languages                                                                                                                                               | ~1,000-1,300 tokens a request                                                                                                                          | Medium: routing; the 20 routing cases in agent-builtin                                               | Refactor                                                    |
| 6   | The app how-to guide (`workspace_section`'s concepts paragraph, ~900 tokens) only when the user asks about the app, as a built-in reference                                                                                         | ~900 tokens a request                                                                                                                                  | Medium-high: the concept cases                                                                       | Refactor                                                    |
| 7   | Keep the prefix across mode switches and saved memories: one tool list for every mode with the mode enforced when a tool runs (as Write mode's propose_edit already refuses), memories in the message rather than the system prompt | One cold prefix write (~11k tokens, $0.027 on Sonnet) per switch or memory                                                                             | Medium: Review mode is read-only by construction today, a deliberate choice                          | Refactor                                                    |
| 8   | A 1-hour cache lifetime on the tools + system breakpoint                                                                                                                                                                            | Messages more than 5 minutes apart read the prefix instead of writing it: $0.0021 instead of $0.026 each, for a $0.042 first write                     | Low-medium: pays only with two or more messages an hour; no data on gaps yet                         | Refactor                                                    |
| 9   | search_document returns whole lines, and in Markdown a line is a paragraph: up to 20 of them. A window of ~300 characters around each match                                                                                         | Worst case ~20k characters to ~6k per call                                                                                                             | Low                                                                                                  | Refactor (tools move)                                       |
| 10  | Read `usage` (with `cached_tokens`) from chat-completions responses, so the eval and a future usage view can see other providers' caching                                                                                           | Visibility                                                                                                                                             | Low                                                                                                  | Refactor (one provider path)                                |
| 11  | Doubao: Ark's Responses API with `caching` where the account has the cache service on, else today's path                                                                                                                            | Most of each step's prefix on Doubao                                                                                                                   | Medium: a second request shape, per-account                                                          | Refactor                                                    |
| 12  | Effort for Auto on Sonnet 5.5 (`high` by default)                                                                                                                                                                                   | Thinking output tokens                                                                                                                                 | Medium-high: quality; a model-comparison run                                                         | Later, with evidence                                        |

Looked at and left alone:

- `max_tokens` (16,384, 32,768 with Deep thinking, 4,096 for single calls)
  is a ceiling, not a charge.
- `compact_history` already stubs old tool results to 400 characters and
  drops whole exchanges in fixed blocks; it keeps the cache valid.
- Tools are only offered when they can do something (file tools with a
  project folder, use_skill with skills, remember when it is on). Review
  mode keeps check_conventions and measure_text, which proofreading and
  length questions use there.
- read_file returns up to ~40k characters of English (~13k of Chinese) per
  call; that is a chapter, and the result is stubbed in later messages.
- The completion prompt was tuned case by case in the live eval (the
  comments in `client.rs` record why each rule is there); trimming it would
  save a few hundred tokens that are now cached anyway.

## Done since

Each item measured with `live_token_usage` before and after, and checked
with the live eval (Sonnet 5.5, `TEXTUS_EVAL_JUDGE=0`) on the same cases.

- **Item 7, the prefix across mode switches and memories.** Write and
  Revise get the same tool list (one propose_edit; in Write, the mode
  section says it only adds text and `propose_insertion` refuses anything
  else), and the interaction mode and the remembered memories moved from
  the system prompt into the message (`request_preamble`); how to use
  `remember` stays in the system prompt. Review keeps its own, read-only
  tool list. A Write message after a Revise one now reads the prefix
  instead of writing it: the run's "Write, continue" step 1.1 went from
  11,017 tokens written and 0 read to 614 written and 10,482 read. The
  prefix itself is 10,482 tokens (was 10,555). Live eval: the 30-case agent
  probe 30/30 before and after, six more Write, Review, memory and
  multi-turn cases 6/6 before and after; no Write proposal was refused.
- **Item 10, usage from every dialect.** `AgentProvider::step` returns a
  `StepUsage` for each dialect, not just Claude's: Chat Completions read
  `usage` (streamed requests ask for it with
  `stream_options.include_usage` where the provider takes it,
  `ProviderCaps::stream_usage`), the Responses API reads it from
  `response.completed`, and the cached part comes from
  `prompt_tokens_details.cached_tokens` (OpenAI, Gemini, Qwen, Doubao),
  `prompt_cache_hit_tokens` (DeepSeek) or `cached_tokens` (Kimi). On
  Doubao, `live_doubao_prefix_cache` now shows it through the app's own
  step: 2,872 of 6,373 tokens read from Ark's cache on the first request
  of one run. The app has no usage view yet; the eval and that test read it.
- **Item 2, the reply with the proposals.** The dialects keep the text a
  model writes with its tool calls, and a tool output says when its call
  is settled (a valid proposal or comment). A step whose calls are all
  settled and that came with text ends the exchange with that text as the
  reply; a refused proposal still goes back to the model. The prompt asks
  for the reply before the calls, written as done. `live_token_usage`: 18
  requests to 14, $0.181 to $0.165, cache reads 170k to 127k tokens.
  Quality, Sonnet 5.5 with the Opus judge on 10 edit cases: 9/10 checks
  and judge mean 4.62 before, 10/10 and 4.56 after. The 30-case probe on
  Doubao (`TEXTUS_EVAL_PROVIDER=doubao`): 27/30 before and after (different
  cases failing), 72 requests to 58.
- **Items 4-6, each rule once, a slimmer skill index, the app guide on
  demand.** The tool instructions no longer repeat propose_edit's action
  list and anchor rules; a built-in skill is indexed by its "Use when ..."
  clause without the request words in eight languages; the app guide loads
  with `use_skill app-guide` (inline where use_skill isn't offered). With
  `count_tokens` unavailable, measured on Doubao's tokenizer: the same
  Review request went from 6,418 to 4,558 prompt tokens. On Doubao, concept
  and routing cases: 7/8 and 15/20 before, 8/8 and 17/20 after.
- **Item 3, long CJK documents by token weight.** Where the model can read
  on, the full-document limit counts Chinese, Japanese and Korean
  characters as 3 (as read_file does), so a CJK document past about 13,000
  characters gets the outline, the start and end and the section the user
  is in. On a 28,000-character Chinese report (new cases
  `long/zh/mid-edit`, `mid-question`, `mid-question-elsewhere`), Doubao:
  5/5 long/zh cases before and after; a message's uncached input fell from
  about 23,100 tokens (sent whole) to about 5,500-6,100 (outline, then
  read_document), and its cost by about half, at one more request.
