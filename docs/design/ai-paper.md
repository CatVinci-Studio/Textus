# AI paper: the long-form writing agent

How Textus AI writes a long paper (5,000-10,000 characters) from a topic:
research, an outline the user approves, sections drafted in parallel, a
review, references. Built in steps; this document says what each part is
for and marks what exists so far.

## The flow

```
topic, files ─► ① plan research ─► ② research helpers ─► dossier
                                                           │
                       ③ outline + figure plan ◄───────────┘ ─► user approves
                                                           │
                ④ sections drafted in parallel, proposed in order ─► ⑤ figures
                                                           │
                       ⑥ review, one round of revision ─► ⑦ abstract, references
```

1. **Plan research**: the topic split into 6-10 questions (background,
   mechanism, state of the art, disputes, cases, data, trends), for breadth.
2. **Research helpers**: four at once, one question each, with web
   search, page reads, scholarly search, the project's files, the files
   attached and the user's references. Each
   returns notes: a claim, its evidence, a quote, the sources' numbers, and
   leads to pictures or data.
3. **Outline**: a thesis, and per section its key points, the notes it
   draws on, a target length and its figures. The one checkpoint: the user
   edits and approves it on a card in the chat.
4. **Drafting**: one helper per section, as many at once as the paper's
   model calls, given the
   outline, its notes and the sections before it in summary. Sections are
   written into the document as they come - each under its heading as its
   writer writes it - with nothing to accept: the user asked for the paper,
   and one Undo takes it out.
5. **Figures**: generated pictures (`textus-picture:`), Mermaid, ```chart
   blocks from the dossier's data, and pictures found on the web with their
   source and licence.
6. **Review**: a read-only helper checks for claims without a source,
   citations that don't match, missing key points, repetition and length;
   at most one round of revision.
7. **Finish**: abstract, figure numbers, the reference list from the source
   book.

## Where it lives

Orchestration is Rust, `src-tauri/src/ai/paper/`; the frontend only shows
it, lazily loaded. Each stage and helper is one run of
`aicompat::agent::run_agent_loop` with its own steps and tools, the way
`ai/agent/chapters.rs` runs its helpers.

### Built so far

- **The model** (`paper/mod.rs`): `Paper` (topic, language, target length
  in characters, its budget), `Dossier` of `Note`s, `Outline` of
  `OutlineSection`s with `FigurePlan`s (`generated`, `mermaid`, `chart`,
  `web`). The TypeScript shapes are generated into
  `src/platform/bindings/ai-paper.ts`.
- **Genres** (`paper/genre.rs`): what kind of piece is written. A genre
  is a `Profile` of the parts of the stages' prompts that differ by kind - what the research covers and prefers, the
  outline's order, the writers' voice, what the review reads for, what
  opens the piece - while each stage keeps its own checks. `Paper` and
  `PaperRequest` carry it; a paper kept before genres is a paper.
  A genre's words live in `paper/prompts/genres/<genre>.md`, one part
  under each heading; its name, lengths, frame and scale stay in
  `genre.rs`.
  A **report** is a long read for the general reader, as the BBC or
  Reuters writes one: its research looks for people, cases, quotes and
  what happens next; its outline is ordered as a story with plain
  crossheads; its writers explain every term on first use, keep numbers
  few and pictured, and say in the sentence who says a thing, citing once
  a sentence; its review also reads for what a newcomer would stumble on;
  it opens on a headline and a bold standfirst, with no label, and ends
  on its sources (`Frame::News`).
  **Choosing** (`paper/choose.rs`): a request that names no genre is
  read first by one tool-less step, told each genre's `when` and lengths,
  which replies with the genre and a length in characters - the length
  the user picked kept when it suits. Its reply is fitted to the genre's
  lengths, and one that can't be read keeps a paper. The choice is sent as
  `genre` before research and kept in `paper.json`, so a paper gone on
  with isn't chosen again.
  **Scale**: each genre also has a `Scale` - its research questions and
  budget, its sections and characters a section, figures at least one
  for every two or three sections or none, whether the user approves its
  outline. An **article** (a newsletter or 公众号 feature, 1,500-4,000
  characters) and a **thread** (numbered posts for X or Weibo, split by
  `---`, each post at most 280 characters, 140 in Chinese, Japanese and
  Korean - a soft check) research less and are written straight on: the
  app approves their outline itself (`GenreForm::checkpoint`). A thread
  is one section, all under its headline, with no heading of its own
  (`GenreForm::headings`), and opens on its headline alone
  (`Frame::Headline`). The run's `genre` event and `ai_paper_status`
  carry the `GenreForm`, so a card back after a restart knows them.
  A **brief** (300-1,500 characters) is a news agency's short story for
  quick or automated reporting: one to three questions on the latest
  reporting, written in the inverted pyramid - the news in the first
  sentence - under a present-tense headline, with no figures, straight on.
  A **review** is a literature review: its research searches the
  scholarly literature first, one study to a note with its method and
  sample, on more scholarly lookups and fewer searches (30, 50, 50, 4);
  its outline goes strand by strand - a theme, an approach, a school -
  never study by study, and ends on the gaps; its writers compare and
  weigh studies rather than list them; at least a figure every three
  sections; framed as a paper (`Frame::Academic`). An **analysis** is a
  report for decision-makers - a market, industry or policy analysis, a
  调研报告: research prefers official statistics, filings and research
  firms (50, 60, 10, 4), every figure kept with its unit, year and who
  measured it; the outline puts the findings first and ends on
  recommendations that rest on them; it opens on a labelled executive
  summary and ends on its sources (`Frame::Executive`). A paper no longer
  takes a literature review.
- **The research budget** (`paper/budget.rs`): searches, page reads,
  scholarly lookups and generated pictures for the whole paper (40, 60,
  30, 6), with what is used. `SharedBudget` lets helpers running at once
  spend one budget, and is what their `WebPlan`s count against
  (`WebPlan::with_budget`); without one a request keeps chat's five
  searches and five page reads (`web/budget.rs`).
- **Events** (`paper/events.rs`): `PaperEvent` over a Tauri Channel - the
  phase, each section's state, the budget, the outline when it is ready,
  errors. Display only; what matters is on disk.
- **On disk** (`paper/store.rs`): `papers/<id>/paper.json`,
  `dossier.json`, `outline.json` in the project's data folder in the
  config folder (`ai/project_data.rs`), or in the scratch space
  (`ai/scratch.rs`) without a project folder, each written
  atomically, so a stopped paper can resume and the user can read the
  research. An id is lowercase letters and digits only.
- **Research** (`paper/research.rs`): one tool-less step plans 4-10
  questions; a helper per question, four at once (their searches too),
  searches and reads and
  keeps findings with `add_note` - a claim, its evidence, an optional quote,
  its sources and leads to pictures or data. A note must cite a number a
  result has or a page's address, so nothing unsourced enters the dossier.
  The helpers share one `WebPlan`: one source numbering for the paper (kept
  as `Dossier::sources`, for the reference list) and one budget. The stages
  run on the `Model` trait, so tests drive them with a scripted model.
  Each question is kept as its helper ends (`research::Progress`), not
  when all have.
- **Tools** (`research::Kit`): a helper runs on the agent's tool layer. One
  `ToolRegistry` shared by every helper has the file tools (`read_file`,
  `find_files`, `search_files`), `search_references` when the project has a
  `references/` folder, and the plugins' and MCP servers' tools
  (`agent::installed_tools`), all executed with `registry.execute` over one
  `ToolContext`: an empty document, the project folder as `root`, the
  paper's folder as `scratch`. Each helper adds its own registry with the
  web tools, ranked by its question, and `add_note` (`paper/notes.rs`), the
  one tool of research's own. Around both, each question's share of the
  budget and the card's activity and budget events.
- **Attached files**: the request names its `conversation`; the files the
  composer staged in that conversation's `attached/` are copied into the
  paper's own `attached/` when it starts (`store::keep_attachments`), so a
  paper going on still has them after the scratch folder is gone. The plan
  sees each one's opening; the helpers are told their paths and read them
  with `read_file`.
- **Outline** (`paper/outline.rs`): the model hands it over with
  `submit_outline`, which checks it whole - a thesis, 3-12 sections with
  titles and key points, notes that exist, at least one figure for every
  two sections, no more generated pictures than the budget allows, lengths
  that add up to the paper's (characters for Chinese, Japanese and Korean,
  else words) - and sends back every problem until it holds.
  `ai_paper_save_outline` keeps the user's edit, dropping notes the dossier
  doesn't have.
- **Drafting** (`paper/draft.rs`, `ai_paper_draft`): a writer per section,
  as many at once as the paper's model calls, given the thesis, what the other sections cover, and its
  notes with their sources' numbers and addresses. It hands the section over
  with `submit_section`, checked for length (60-150% of its target, prose
  only), citations (`[n](address)` for this section's sources only, never a
  bare `[n]`) and its planned figures: a `mermaid block, a `chart block
  whose JSON the renderer can draw, a `textus-picture:` line, or a
  `<!-- textus-figure web: … -->` mark until a web picture is found. Its
  diagrams and charts are then drawn (`paper/figures.rs`): the run sends
  them as `drawFigures`, the window draws each with Mermaid itself - which
  Pele falls back to and exports use - and the chart renderer
  (`ai/paper/figure-check.ts`), and answers with `ai_paper_figures_drawn`;
  one that doesn't draw goes back to its writer with the renderer's error,
  a hard problem. The chart check holds every rule of the renderer's
  (`src/editor/chart/chart-cases.json` is read by both test suites). No
  answer in 30 seconds, or no window, leaves the section to these checks. Sections
  are kept as `section-<n>.md` and, after the review, sent as
  `sectionDrafted` in the outline's order. Each is kept as soon as it is
  written, whatever the order they finish in, so a stop costs no finished
  section. A section whose writer fails (its model's error; a section
  handed over at all is kept) starts no more; those under way are kept,
  then the draft stops, so the paper has no gap.
- **At once** (`paper/throttle.rs`): every stage steps one `Throttled`
  model - at most `paper_at_once` calls in flight, a provider's catalog
  data (Ollama 2, OpenAI 6), with no setting. A call refused for its rate
  or an overload (429, 502, 503, 529) gives up one slot for good (one is
  always kept), waits 2, 4, 8, 16 s and goes again, keeping its slot; one
  that already streamed part of its answer isn't tried again. Stages start the next piece as soon as any is done and put the
  results back in order. Finishing searches Commons four marks at a time
  and looks up six source titles at a time, writing the opening meanwhile.
  Nothing is spawned: a stop drops every call under way.
- **Review** (`paper/review.rs`): once every section is drafted, a reader
  who sees them all reports with `report_issues` what only the whole shows -
  repetition, contradictions, an outline point no section makes, a figure
  never referred to, a claim stronger than its notes - at most three points
  a section. Each faulted section is revised once by its writer, under the
  same checks; a revision that doesn't hold, or a review that fails, leaves
  the drafts. Only then are the sections sent, so no proposal is replaced.
- **Finish** (`paper/finish.rs`): picture lines are begun with the user's
  image model (`images::place_pictures`, up to its per-send limit, which
  also caps the pictures the outline may plan) and become
  `textus-generated:` pictures; without an image model they are dropped.
  Then every diagram and chart is drawn once more, for sections no
  writer's check saw drawn (kept from an earlier run, repaired, or kept on
  a last try), and one that still doesn't draw is taken out - before the
  numbering, so the numbers have no gap and no figure reaches the paper as
  its code. Then every diagram, chart, picture and web-picture mark gets a numbered
  caption, counted through the paper (a chart's caption or title, a
  picture's alt text; a chart's caption then leaves its JSON, so it is
  said once); the reference list holds the sources the text cites,
  by number, and each citation becomes `\[n\]` linked to its entry there
  (`#ref-n`, which the editor finds by the entry's leading `[n]`), escaped so
  the footnote setting leaves it alone - a bare `[n]` inside a chart, whose
  JSON has no `\[`; a tool-less step writes the title and abstract (the
  topic alone if its reply can't be read). Headings and labels follow the
  paper's language. The whole paper is sent once, as `ready`, to be proposed
  as one append, and the run ends at `done`.
- **`ai_paper_run`** (`PaperRequest`): researches the paper, outlines it,
  saves both and stops at `awaitingOutline`. Given the `id` of a paper kept
  before, it goes on from what that kept: its research and its outline are
  not made again.
- **Going on later**: a paper keeps its `stage` in `paper.json` -
  `researching` (kept at once; its research kept question by question in
  `research.json` - the questions planned, each finished helper's notes and
  the sources they cite - so a stop there, a failure or spent model calls
  cost only the questions still open: going on doesn't plan again, gives
  the kept sources their numbers in the new run's book, and asks the rest
  with what is left of the budget; the file goes once the dossier is kept),
  `outlined`, `drafting` (set when the outline is
  approved, which drops sections drafted from an earlier outline), `done`.
  `ai_paper_status` reads it with the outline and how many sections are
  written; `ai_paper_draft` hands on the sections already written as they
  are and writes only the rest, so a paper stopped - or the app quit -
  mid-draft costs only the sections being written.
  On the card, **Pause** stops the run (a stop is no error) and
  **Continue** - also offered after a failure - asks `ai_paper_status` and
  goes on: drafting again for a paper being drafted, which takes back the
  place of what was written of it (its `# topic` title over its first
  section's heading) instead of writing it twice; research and outline
  otherwise. A card's key is its paper's id, so a card back after a restart
  asks how far its paper came: its outline to approve, Continue, or
  written.

- **In the app** (`document-view/usePaperWriter.ts`, `ai/paper/paper-store.ts`,
  the lazy `paper` module): the AI panel's fourth mode, **Research**, takes
  the message as the paper's topic, of the kind picked beside the mode - **Choose for me** (the default) lets the model choose it and its length, a genre picked is written at the middle of its lengths -
  under the message box; it never reaches the chat agent, so it is no skill's mode and
  not a default. The conversation
  gets the user's ask and a card (`write_paper` turns, which Rust keeps from
  the model); the card follows the run from the paper store and shows the
  outline card while the run waits. Approve saves the edited outline and
  drafts straight into the document (`usePaperDocument`, `paper-write.ts`):
  the whole document when it is empty, else after its end, a place
  `paperRegionPlugin` keeps while the user edits around it. The topic and
  the section headings go in at once, and each section fills in under its
  heading from `sectionText` - its whole text, sent again as kept - at most
  once a frame, only the top-level blocks that changed replaced; a
  revision rewrites its section the same way. `ready` puts the finished
  paper - title, abstract, sections, references - in that place as one
  step, so one Undo takes it out; a run that stops keeps what was written.
  Nothing is proposed. The text goes in without its pictures; each is then
  saved beside the document as it is made (`paper-pictures.ts`) and put
  above its numbered caption, a step of its own, the card counting those
  to come. A picture whose caption the user has removed is left out. The
  language is the topic's script's, else the UI's.

- **Local sources** (`paper/sources.rs`): `add_note` may cite a file by
  the path `read_file` reads it by - `attached/…` from the paper's folder, or
  any project file such as `references/…` - accepted when it resolves
  there. The file becomes a source like a page - its path percent-encoded
  so a link holds it - cited `[n](attached/…)` or `[n](references/…)`,
  accepted by the section checks, and listed in the references: an
  attached file by its name, a project file by name and path. With a
  `references/` folder the helpers are told to search it first.

- **Web pictures** (`paper/web_figures.rs`, `web/commons.rs`): a writer marks
  a `web` figure as `<!-- textus-figure web: caption | English search words
-->`. Before the figures are numbered each mark becomes the best picture
  on Wikimedia Commons - Commons only, since a picture from any other page
  comes with no licence to use it - kept in the picture store like a
  generated one (shown in place, saved only on accept), with a credit line
  after its caption: author, licence and a link to its Commons page. A real picture comes first: a mark nothing is found for
  becomes a picture for the image model to make instead (its caption and
  search words as the prompt), begun with the planned generated ones and
  left out with them when there is no image model; the outline plans
  `generated` only for what nothing real could show.

- **Tuned on a real run** (MiniMax, 5,000 characters): each question's helper
  gets an even share of the research budget (the first helpers had spent it
  all); the outline's shape follows the length - about one section per 800
  characters, at most a figure per section plus one, web pictures at most a
  third of the sections (it had planned 12 sections and 15 figures); a
  section whose last try has only soft problems (its length, a missing
  planned figure) is kept rather than lose the paper; one that never gets
  past a wrong citation or a broken chart is kept too, repaired - its
  citations linked to their sources' addresses or left out, its broken
  charts taken out - since a run stopping at its eighth section on a chart
  lost the paper's remaining sections (a revision that never holds keeps
  the draft it was to replace); the dossier keeps only the sources its
  notes cite. A third run wrote a whole paper but three times too long, so a
  section now holds at 70-120% of its target, is kept at 50-140% only as a
  last try, and is sent back beyond; writers are told their most. Sources
  cited by a DOI alone get their title from OpenAlex, an untitled source is
  listed by its address once, and addresses are stored link-safe (a DOI
  with parentheses had cut its citation short). A fourth run came in at
  1.4 times its length with a Commons photo; from it, a note can't rest on
  a search page or a search API's answer (helpers without a search service
  had read DuckDuckGo's results pages); writers never write about the
  research and never number figures (a hard check catches "图 1" or
  "Figure 1"); untitled pages get their own title; a trailing slash no
  longer splits a source. `paper/live.rs` runs a whole paper on a real provider
  (`cargo test --lib live_paper -- --ignored --nocapture`), printing every
  rejection.

- **Prompts and tuning** (`paper/prompts.rs`, `paper/prompts/`,
  `paper/tuning.rs`): every stage's prompt is Markdown in
  `paper/prompts/<stage>.md` - a `## name` heading begins each prompt,
  its `{{key}}`s filled in by the code; a dotted `{{shared.zh-filler}}`
  or `{{genre.paper.cite}}` takes in another prompt as the files are
  read, so a rule the genres share is written once (`shared.md`). The
  tests fill every prompt for every genre and fail on a key without a
  value or a value without a key. The numbers the stages are tuned by -
  the length bands, steps, how many run at once, the outline's figure
  limits - are in `tuning.rs`, each with the run it came from; a
  section's problems carry whether they are soft (`Problem { soft }`),
  so rewording a check can't change what is kept. To try other wording
  without building again, point `TEXTUS_PAPER_PROMPTS` at a folder laid
  out as `prompts/` with only the files to change (a debug build reads
  it; a release build never does); `live_paper` keeps each run under its
  prompts' fingerprint, so two wordings can be run and compared.

### To come

Further real runs, on other providers and lengths.
