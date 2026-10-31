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
- **`ai_paper_run`** (`PaperRequest`): plans and researches the paper and
  saves it with its dossier. The frontend doesn't call it yet.

### To come

The outline card, drafting, review and the entry point, each a
branch stacked on the one before; scholarly search, the reference library,
the `chart` block and web pictures are independent tools the stages pick up
once they are registered.
