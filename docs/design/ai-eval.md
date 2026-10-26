# AI evaluation

How the AI features are checked against real providers: what the suites
cover, how a case is judged, and how to run them. The suites live in
`src-tauri/src/ai/live_eval.rs` and `src-tauri/src/ai/live_eval/`. The
record of earlier rounds (what each found and what changed because of it)
is in [archive/2026-10-ai-eval-rounds.md](../archive/2026-10-ai-eval-rounds.md).

Every live test is `#[ignore]`d: it needs a key and spends money, so CI
never runs it. The checking code itself (language detection, the Markdown
skeleton, edit composition, the writing-rules checks) is unit-tested and
runs with the normal `cargo test`.

## What is evaluated

Each case goes through the app's real code path: the same system prompts,
tools, agent loop, completion and grammar prompts, and the same
post-processing (`finish_completion`, `finish_grammar`). Where the
frontend changes the model's output, the eval does the same: an accepted
`propose_edit` is composed as `src/ai/doc-markdown.ts` composes it, and a
completion is shown after the editor's `stripEcho` and `tidySuggestion`.

| Suite (test)                                      | What it covers                                                                                                                                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent` (`live_agent_matrix`)                     | Edits and answers in ten languages; Markdown structures (tables, lists, code, math, footnotes, front matter); summarise, expand, review, follow-ups; the project folder, writing instructions, style profile, library and skills |
| `agent-builtin` (`live_agent_builtin`)            | The built-in skills (social posts, registers, house styles) and which skill a request is routed to                                                                                                                               |
| `continuing` (`continuing::*`)                    | A request on top of proposals the writer has not yet accepted or rejected                                                                                                                                                        |
| `completion` (`live_completion_matrix`)           | Inline completion: every tone, every language, lists, tables, headings, code, the cursor inside a word                                                                                                                           |
| `grammar` (`live_grammar_matrix`)                 | Each strictness level on real mistakes and on correct text, with the writing-rules engine's findings merged in                                                                                                                   |
| `memory` (`memory_eval::*`, `memory_sessions::*`) | What the memory pass keeps, where it puts it, and what it leaves out, in one exchange and over several conversations                                                                                                             |

`list_eval_cases` and `list_builtin_cases` are free and need no key: they
print the case ids a run would send, for sizing it first.

## How a case is judged

**Automatic checks** fail the test:

- Edit or no edit, as the request calls for; every proposal valid on its
  first try.
- The reply in the language of the user's message; the edited text in the
  document's language (or a translation's target).
- Nothing changed outside the passage the request named, and the Markdown
  structure unchanged or changed by exactly the expected amount (one more
  table row, one task checked).
- Per case: shorter or longer, strings that must be in the result, tools
  that must be called (read before editing a long document, `use_skill`).
- Replies: no tool names or line numbers; in Chinese and Japanese, no ASCII
  punctuation against CJK text.
- Completion: no echo of the text before the cursor, no doubled text at the
  join, no invented figures, the right length and language.
- Grammar: every known mistake flagged, applying the fixes gives the
  corrected text, nothing flagged on code, URLs, math or names.

**Judging** is reported, not asserted. Runs leave the API judge off
(`TEXTUS_EVAL_JUDGE=0`, the default in the script), and the recorded rows
are graded afterwards on faithfulness, helpfulness, minimality, tone and
correctness, with a verdict (good / acceptable / bad). Each
`<suite>.jsonl` row has everything a judge needs: the input, every tool
call and its result, the composed diff, and the case's rubric.
`TEXTUS_EVAL_JUDGE=1` has a model judge each case instead (about three
times the requests).

## Running it

The usual way in is `scripts/live-eval.mjs`. It defaults to no judge, a
US$1 budget and the keys from `.env.local`, and writes to
`tmp/live-eval/<provider>-<suite>-<time>/`:

```sh
node scripts/live-eval.mjs run --provider deepseek --suite matrix --set core
node scripts/live-eval.mjs run --provider chatgpt --suite continuing --model gpt-6-sol
node scripts/live-eval.mjs compare src-tauri/src/ai/live_eval/baselines/deepseek.json tmp/live-eval/deepseek-matrix-…
node scripts/live-eval.mjs baseline tmp/live-eval/deepseek-matrix-… deepseek
```

- `--set core` runs the agent cases in `live_eval/baselines/core.txt`, one
  or two per group, at about a fifth of a full run's cost. Use it while
  iterating, and on each provider before a release.
- `compare` lists the agent cases that started or stopped passing between
  two runs, or between a run and a provider's baseline.
- `baseline` keeps a run as the provider's baseline; update it when a
  change is meant to move the numbers.

By hand, from `src-tauri/`:

```sh
cargo test --lib live_eval -- --ignored --nocapture --test-threads=1
```

Keys come from the environment or `.env.local` at the repository root, one
`NAME=value` per line. Useful variables:

| Variable                    | Effect                                                                |
| --------------------------- | --------------------------------------------------------------------- |
| `TEXTUS_EVAL_FILTER`        | Only cases whose id contains one of these comma-separated substrings  |
| `TEXTUS_EVAL_PROVIDER`      | Run the agent on `chatgpt`, `deepseek`, `minimax`, `doubao`, `vertex` |
| `TEXTUS_EVAL_AGENT_MODEL`   | Run the agent matrix on another model                                 |
| `TEXTUS_EVAL_WRITING_MODEL` | Run completion and grammar on another model                           |
| `TEXTUS_EVAL_JUDGE=1`       | Also judge each case with a model                                     |
| `TEXTUS_EVAL_JOBS`          | Concurrent cases (default 6)                                          |
| `TEXTUS_EVAL_OUT`           | Output folder (default: a new folder under the system temp dir)       |
| `TEXTUS_EVAL_BUDGET_USD`    | Stop starting cases once this run has spent this much (list prices)   |
| `TEXTUS_EVAL_SPEND_FILE`    | A `{"spent_usd", "runs"}` ledger each finished suite adds its cost to |

Each suite writes `<suite>.jsonl` (one row per case), `<suite>.md` (the
summary table), `<suite>.usage.json` (tokens and dollars) and
`cases-index.json` (every case's id and its passed and failed checks). A
case that never reached the API, or that the budget skipped, has a failed
`request` or `budget` check; those rows say nothing about the prompts.

An agent case costs about two or three US cents; completion and grammar
cost about a cent per whole suite. The test binary's name does not depend
on the checkout, so with a target dir shared between worktrees, copy the
built binary somewhere private before a long run.
