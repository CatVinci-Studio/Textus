# Testing map

Five suites, from cheapest to most expensive:

```sh
npm run check                          # typecheck, lint, vitest, prettier, README structure
npm run check:native                   # rustfmt, clippy, Rust tests (app crate + aicompat)
npm run test:e2e                       # Playwright flows in Chromium, desktop and phone
scripts/smoke-linux.sh --build         # the built Linux app and its .deb
npm run screenshots:readme             # regenerate the README screenshots (e2e/shots/readme/)
npm run screenshots:website            # the website's app screenshots (e2e/shots/website/)
npm run bench:motion                   # frame timing of every animation and scroll (e2e/bench/)
cd src-tauri && cargo test --lib live_eval -- --ignored --nocapture --test-threads=1
                                       # real Anthropic API (costs money - docs/design/ai-eval.md)
```

The first three run in CI, the same commands on every platform. One part
of `npm run check` runs in CI only once, in the `check` job, and on a pull
request only when the change can reach saving: the save round trip
(`src/document-view/save-roundtrip*.test.ts`, see
[saving.md](saving.md#the-round-trip-test)), which tests
platform-independent code. The native jobs' `npm test` skips it with
`TEXTUS_SKIP_ROUNDTRIP=1`; locally `npm run check` always runs it. The rest
need a display, a desktop session or an API key, and are run by hand before
a release. The e2e flows need Chromium once: `npm run setup:e2e`.
`npm run test:visual` adds the screenshot comparison of `e2e/visual.spec.ts`
against Linux baselines (they depend on the fonts of the machine that took
them). `E2E_WEBKIT=1 npm run test:e2e` adds a WebKit project for the few
flows that broke in WebKit only (`WEBKIT_SPECS` in `playwright.config.ts`);
it needs `npx playwright install webkit` once, and CI doesn't run it.

`npm run bench:motion` is a measurement, not a test: it plays every
animated surface (the side panels and their resize, Settings, tabs, menus,
the revision stream and its margin cards, a diagram building up, scrolling)
with the animations on, in Chromium slowed four times - about the speed of
WebKitGTK on a laptop - and prints each one's dropped frames, long tasks,
forced layouts and style and layout time. Run it on `main` and on your
branch, on a quiet machine (other builds or test runs skew it), and
compare. `BENCH_CPU=1` runs it at full speed, `BENCH_TRACE=1` also saves a
Chromium trace of each scenario; the header of `e2e/bench/motion.bench.ts`
has the rest. Animations only move `opacity` and `transform`
([design-language.md](../design/design-language.md#motion)); the unit test
`src/ui/motion-properties.test.ts` reads every stylesheet and fails on
anything else.

CI also builds the iOS app for the simulator, unsigned, on macOS (the `ios`
job) - proof that the desktop/iOS split in `docs/dev/ios-code-map.md` still
compiles. Running it on a device is a manual step on a Mac.

## Large-document benchmark

```sh
npm run bench:large-doc                       # every document, a few minutes
PERF_DOCS=zh-5k PERF_LABEL=after npm run bench:large-doc
```

`e2e/perf/large-doc.perf.ts` opens generated documents (`e2e/perf/large-docs.ts`:
Chinese and English, 1k to 20k top-level blocks with formulas, diagrams,
code, images, tables and HTML, plus 200k characters of plain text) in
Chromium and measures opening, typing in the middle (input to next frame,
p50/p95, with each plugin's share), IME commits, scrolling end to end, a
jump to the last heading, a save and a tab switch. It asserts nothing and is not part of
`test:e2e` or CI. Results print to the console and land in
`test-results/perf/`; the documents are written to `e2e/perf/fixtures/` for
opening by hand in the real app, where WebKitGTK, WKWebView and WebView2
can only be timed by eye. Compare runs on the same machine only.

## Flaky tests

On CI, a Playwright test that fails is run once more. If the second run
passes, the job stays green and the test is reported as **flaky**: the
`list` reporter names it in the summary at the end of the log, and the
`github` reporter adds an annotation to the run. Locally there is no retry,
so a failure on your machine is always a failure. The setting is `retries`
in `playwright.config.ts`.

A flaky test is still a bug - in the test, or in the app. Don't ignore the
annotation. To find out how flaky a test is, run it many times:

```sh
PLAYWRIGHT_PORT=1445 npx playwright test e2e/writing.spec.ts \
  -g "the test's title" --repeat-each=100 --workers=4
```

`--workers` above 1 adds load, which brings out timing problems sooner. To
slow the page down the way a CI runner does, add this to a temporary copy of
the spec (don't commit it):

```ts
test.beforeEach(async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
});
```

When you fix one, wait for the thing the assertion depends on - an element
being focused, a CSS variable reaching its value, an event having fired -
with `expect(...)` or `expect.poll(...)`. A longer `waitForTimeout` only
makes the failure rarer. A fix is done when 100 repeats under throttling
pass.

## What is covered, by kind

The suites divide by _what kind of mistake they catch_, which is more useful
than dividing by file. Counts are left out on purpose - they go stale; run
the suite to see them.

### 1. Text and position algebra (vitest)

The group most worth having: this is where a bug is silent and destroys the
user's document.

| Area                    | Catches                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ai/doc-markdown`       | Markdown-space matching (exact, then typography-normalized), anchor disambiguation, inline vs block insertion, caret context. |
| `ai/chat/sentence-diff` | Splitting a proposal into per-sentence changes, and rebuilding the text from the subset the user ticked.                      |
| `ai/chat/line-diff`     | The diff shown on a proposal card.                                                                                            |
| `ai/pending-edit-focus` | Review order and where focus lands after accept/reject.                                                                       |
| `ai/text-locate`        | Locating plain text inside a block for the strike range.                                                                      |
| `ai/chat/user-message`  | The `<selected-text>`/`<attached-file>` wire format, round-tripped through the writer.                                        |
| `ai/ghost-text-plugin`  | Completion echo stripping, word-by-word accept, candidate splitting.                                                          |
| `save-roundtrip`        | Saving after an edit: untouched blocks kept byte for byte, no text lost on reading back (saving.md).                          |

### 2. Wire formats and provider dialects (`aicompat`)

Every one of these fails as an opaque HTTP 400 if it regresses, so they are
pinned rather than trusted.

- Turn-list → request body for three dialects (Responses API, Anthropic
  Messages, chat-completions), including tool-call grouping, image parts,
  prompt caching, empty assistant turns and the thinking setting per model.
- SSE stream accumulation: text deltas, indexed tool-call fragments,
  mid-stream errors.
- The agent loop: tool dispatch, step limit (ends on a synthetic assistant
  turn rather than a dangling tool result).
- Model-list tidying: what counts as a chat model, ordering by release.

### 3. Backend rules (app crate)

| Module                  | Catches                                                                                                                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai::agent`             | The scripted agent loop end to end, history compaction, where the document rides (current turn only), focus-section selection on long docs.                                                                                                                             |
| `ai::tools`             | `propose_edit`/`add_comment` anchor validation, including near-miss matching.                                                                                                                                                                                           |
| `ai::project`           | Project folder access: containment, hidden files, size caps, search, `.textus/style.md` and `.textus/library/` parsing and relevance.                                                                                                                                   |
| `ai::workspace`         | Skill parsing, root resolution and the too-broad-folder guard.                                                                                                                                                                                                          |
| `ai::client`            | Completion prompt assembly, candidate splitting, grammar-issue relocation (CJK offsets), merging the rules engine's findings.                                                                                                                                           |
| `ai::rules`             | The writing-rules engine: every rule per language with its guards and never-flag cases, profiles and settings, Markdown blocks, majority, fix idempotency, post-processing, platform counts, timing. `sweep` (ignored) runs it over the help guides and eval documents. |
| `ai::catalog`           | Every pinned default model exists in the models.dev snapshot.                                                                                                                                                                                                           |
| `commands::chat_window` | Which chat serves which editor, what a closed window frees.                                                                                                                                                                                                             |
| `commands::attachment`  | OOXML text extraction and truncation marking.                                                                                                                                                                                                                           |
| `atomic`, `session`     | Secret files written 0600 and atomically, private temp files and folders, what a closing window leaves in the session.                                                                                                                                                  |

### 4. Frontend state and rendering (vitest)

Settings migration (a rejected value must not discard the rest), the
composer, streaming tool arguments, the proposal state machine
(docs/design/ai-proposals.md), cancelled turns, AI error classification, the chat
history grouping, the tutorial, the Windows-only window frame, menus and
shortcuts, export pagination, themes, and the AI concept copy (the agent.md
starters send nothing; templates name the menu items as the menus do).

### 5. Visual (Playwright, `e2e/`)

The real frontend in Chromium against the Vite dev server, with the dev
Tauri shim (`dev/tauri-shim.ts`) standing in for the backend. Each test
drives a flow and compares a screenshot: first run, the sidebar lesson, a
document in light and dark (including the table-header regression, #15),
split view, zen mode, the AI panel, an agent reply with a reasoned edit, the
sentence picker and a comment (accepting only some sentences is checked in
the document), Quick Ask, settings. Other specs assert behaviour without a
screenshot: the file-backed storage (the boot snapshot, a close that waits
for settings still on their way), the CJK font stacks, the phone, an
iPad's keyboard shortcuts and review-step focus, and the Windows PDF
export's page margins around blocks taller than a page (#151).

Baselines are per platform. After an intended UI change:
`npm run test:visual -- --update-snapshots`, then look at every changed
image before keeping it - a baseline happily records a bug.

### 6. Built app (`scripts/smoke-linux.sh`)

The release binary and `.deb`: the package's binary, icons and `.desktop`
entry (takes files, claims Markdown); the app starting on a file; a second
launch handing its file to the running instance and exiting. Runs with
throwaway config/data directories. Window checks need niri; `--screenshot`
also needs the screen unlocked.

### 7. Live (`ai::live_eval`, ignored by default)

An evaluation matrix for every AI feature, run through the app's own
prompts, tools and agent loop against the real API: the agent (75 cases -
eleven document languages, edits inside every Markdown construct, reviews,
questions, the three modes, agent.md, style, library, skills, project files,
multi-turn follow-ups, a long document), inline completion (43 - every tone,
language and block type, the cursor mid-word, candidates) and the grammar
check (26 - every strictness level, real mistakes and correct text). Each
case gets automatic checks (edit vs answer, reply and edit language, bytes
outside the target untouched, Markdown structure re-parsed and compared,
tool use, completion spacing and length, grammar recall and false
positives) and an Opus judge's 1-5 scores; model-comparison runs put the
defaults side by side with the other current models. Results land in a
`.jsonl` and `.md` per suite. `docs/design/ai-eval.md` has the matrix, how to run
and filter it, and the latest before/after results.

Keys live in one env file, `.env.local` at the repository root (git-ignored;
`TEXTUS_ENV_FILE` points elsewhere), one `NAME=value` per line -
`ANTHROPIC_API_KEY`, `VOLCENGINE_ARK_API_KEY` and so on - or in the
environment, which wins. The older `.anthropic-api-key.local` still works.
Without a key every test passes vacuously. A full run costs
real money - filter with `TEXTUS_EVAL_FILTER` and skip the judge with
`TEXTUS_EVAL_JUDGE=0` while iterating. The checking code itself is
unit-tested and runs with the normal `cargo test`.

`live_eval::doubao` is separate: three requests against Volcengine Ark (a
writing call, a tool call, an image) that check Textus's request shapes for
the Doubao provider, keyed by `$VOLCENGINE_ARK_API_KEY` and skipped without
it. `live_eval::deepseek` does the same for DeepSeek, keyed by
`$DEEPSEEK_API_KEY`: thinking with tools at each level, across steps and
into a follow-up; DeepSeek's Search and Fetch APIs as Textus's own
web_search, with numbered sources; the usage with prompt-cache hits; the
writing calls; and the model list - about two US cents in all.
`live_eval::images` makes one picture at each image service whose key is
set (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `VOLCENGINE_ARK_API_KEY`,
`DASHSCOPE_API_KEY`, `ZHIPU_API_KEY`, `SILICONFLOW_API_KEY`), with the
cheapest model and smallest size the image catalog offers there - about one
to three US cents each; the request and reply shapes themselves are tested
against local HTTP fixtures in `aicompat::images`.

## What is deliberately not covered

- **WebKitGTK and WebView2 rendering.** The visual suite runs Chromium; the
  shipped app does not. The smoke test proves the Linux build starts, not
  that it looks the same.
- **macOS and Windows native behaviour**: drag-to-merge, the file dialogs,
  the updater, PDF export, notarized bundles. CI proves they compile.
- **Attachment extraction of real files.** The OOXML parser is tested on
  hand-written XML; `pdf-extract` and `calamine` are trusted.

Changes to window management, drafts, or anything that can lose unsaved
work must still be exercised by hand, and the PR should say what was.
