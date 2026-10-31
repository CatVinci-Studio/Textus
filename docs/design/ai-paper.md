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
2. **Research helpers**: up to four at once, one question each, with web
   search, page reads, scholarly search and the user's references. Each
   returns notes: a claim, its evidence, a quote, the sources' numbers, and
   leads to pictures or data.
3. **Outline**: a thesis, and per section its key points, the notes it
   draws on, a target length and its figures. The one checkpoint: the user
   edits and approves it on a card in the chat.
4. **Drafting**: one helper per section, up to three at once, given the
   outline, its notes and the sections before it in summary. Sections are
   held until those before them are done, then proposed in order with
   `propose_edit`'s `append`, one proposal each - every change stays a
   proposal the user accepts (ai-proposals.md).
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
- **The research budget** (`paper/budget.rs`): searches, page reads,
  scholarly lookups and generated pictures for the whole paper (40, 60,
  30, 6), with what is used. `SharedBudget` lets helpers running at once
  spend one budget, and is what their `WebPlan`s count against
  (`WebPlan::with_budget`); without one a request keeps chat's five
  searches and five page reads (`web/budget.rs`).
- **Events** (`paper/events.rs`): `PaperEvent` over a Tauri Channel - the
  phase, each section's state, the budget, the outline when it is ready,
  errors. Display only; what matters is on disk.
- **On disk** (`paper/store.rs`): `.textus/papers/<id>/paper.json`,
  `dossier.json`, `outline.json` in the project folder, each written
  atomically, so a stopped paper can resume and the user can read the
  research. An id is lowercase letters and digits only.
- **Research** (`paper/research.rs`): one tool-less step plans 4-10
  questions; a helper per question, four at a time, searches and reads and
  keeps findings with `add_note` - a claim, its evidence, an optional quote,
  its sources and leads to pictures or data. A note must cite a number a
  result has or a page's address, so nothing unsourced enters the dossier.
  The helpers share one `WebPlan`: one source numbering for the paper (kept
  as `Dossier::sources`, for the reference list) and one budget. The stages
  run on the `Model` trait, so tests drive them with a scripted model.
- **Outline** (`paper/outline.rs`): the model hands it over with
  `submit_outline`, which checks it whole - a thesis, 3-12 sections with
  titles and key points, notes that exist, at least one figure for every
  two sections, no more generated pictures than the budget allows, lengths
  that add up to the paper's (characters for Chinese, Japanese and Korean,
  else words) - and sends back every problem until it holds.
  `ai_paper_save_outline` keeps the user's edit, dropping notes the dossier
  doesn't have.
- **Drafting** (`paper/draft.rs`, `ai_paper_draft`): a writer per section,
  three at once, given the thesis, what the other sections cover, and its
  notes with their sources' numbers and addresses. It hands the section over
  with `submit_section`, checked for length (60-150% of its target, prose
  only), citations (`[n](address)` for this section's sources only, never a
  bare `[n]`) and its planned figures: a `mermaid block, a `chart block
  whose JSON the renderer can draw, a `textus-picture:` line, or a
  `<!-- textus-figure web: … -->` mark until a web picture is found. Sections
  are kept as `section-<n>.md` and, after the review, sent as
  `sectionDrafted` in the outline's order; a failed section stops the ones after it, so the paper has no gap.
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
  Then every diagram, chart, picture and web-picture mark gets a numbered
  caption, counted through the paper (a chart's caption or title, a
  picture's alt text); the reference list holds the sources the text cites,
  by number, and the citations become plain `\[n\]` so the footnote setting
  leaves them alone; a tool-less step writes the title and abstract (the
  topic alone if its reply can't be read). Headings and labels follow the
  paper's language. The whole paper is sent once, as `ready`, to be proposed
  as one append, and the run ends at `done`.
- **`ai_paper_run`** (`PaperRequest`): researches the paper, outlines it,
  saves both and stops at `awaitingOutline`. The frontend doesn't call it
  yet.

### To come

The entry point that starts a paper, shows its progress and outline card,
and turns its events into proposals - `opening`, each section, `references`,
each appended in order. Scholarly search, the reference library, the
`chart` block and web pictures are independent tools the stages pick up once
they are registered.
