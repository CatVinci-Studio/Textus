# AI proposals: lifecycle and behavior

How a `propose_edit` tool call travels from streamed arguments to text in the
document, what consecutive prompts do to undecided proposals, and what stop /
failure / close leave behind. Every rule here is enforced in code; the file
that owns each one is named so this document can be checked against reality.

## The surfaces, and the one path into the document

Chat has three surfaces and two conversations, all owned by the editor
(`document-view/MilkdownEditor.tsx`):

- **The AI panel** — docked on the right (`ai/chat/panel/agent-panel.tsx`,
  `AgentPanelView.tsx`). Shows the editor's main conversation, the one saved
  to History.
- **The detached chat window** — the same main conversation popped out into
  its own OS window, one per editor window (desktop only). It owns no
  document state: proposals and accept/reject travel over
  `ai/chat/window/chat-bridge.ts` back to the editor window.
- **Quick Ask** — the in-document bar (`ai/chat/quick-ask/useInlineChat.ts`). It has its
  own short conversation, kept out of History and independent of the
  panel; "Continue in the full conversation" hands its turns to the main
  conversation (`expandQuickAsk`).

All render the same `ChatBody`, and all feed one resolution pipeline:
`MilkdownEditor → usePendingEdits → pending-edit-plugin`. Anchors resolve in
**markdown source space** (`ai/doc-markdown.ts`), matching what the model was
shown. Previews are pure decorations - until the user clicks Accept, the
document text is untouched. Accept (`applyEditRange`) is the **only** write
path: one transaction, one undo step, no direct-apply fallback.

## Modes: which proposals a conversation may make

The composer's mode (`AgentMode`, see
[ai-concepts.md](ai-concepts.md#not-a-file-modes)) decides what reaches
this pipeline, and it is enforced in Rust, not only asked for in the prompt
(`tools.rs`'s `builtin_tools`):

| Mode   | `propose_edit`                                                     |
| ------ | ------------------------------------------------------------------ |
| Write  | `append`, `insert_at_cursor`, `insert_after`, `insert_before` only |
| Review | not offered                                                        |
| Revise | every action                                                       |

The panel and the detached window offer all three; Quick Ask offers Revise
and Review only (`COMPOSER_MODES`, [ai-concepts.md](ai-concepts.md#not-a-file-modes)).

Write's schema lists only the insertion actions, and `propose_insertion`
refuses any other action a model sends anyway; the refusal is a tool result
like any validation failure, so its streamed preview is discarded
(`isRefusal`) and nothing that replaces or deletes text reaches the editor.
A Write proposal is the same green pending block as any insertion: shown,
not applied, until Accept. With a selection, Write inserts after it
(`insert_after`), never over it.

### Pictures: `generate_image`

With an image model set (Settings › Textus AI › Image model; none by
default), Write and Revise also get `generate_image`, whose call is a
proposal too: an insertion of one Markdown image. The tool makes the
picture (`ai/images.rs`'s `ImageRun::execute`), keeps it in memory, and
records its id in the call's arguments; the loop reports a step with such
a call only once it has run (aicompat's `ToolRun::Amending`) - so the call
turn the frontend receives is already the proposal (`parseImageProposal`). Its text
names the picture by a placeholder src; only the preview swaps in the bytes
(`generated-images.ts`), and it comes in whole, never typed out. Accept
saves the picture the way Settings › Images says for a pasted one, then
writes the image with the saved src through the same `applyEditRange`;
undo brings the proposal back, and accepting it again reuses that file.
Reject lets the picture go in the backend too. A call that made no picture
(refused by the service, out of quota, at most two per send) is a refusal
like any other: no preview, and its card is the service's reason.

## Writing phase: the `ProposalStream` machine

`ai/revision/proposal-stream.ts` - plain logic, no ProseMirror dependency. Every
lifecycle decision for a streamed proposal lives here; `MilkdownEditor` only
wires the machine's effects to the editor (place → streaming preview, feed →
typewriter, finalize → decidable re-show, discard → reject).

```mermaid
flowchart LR
    TS([toolStart<br/>propose_edit]) --> D[drafting<br/>args accumulating,<br/>nothing on screen]
    D -- "argsDelta: action complete,<br/>anchor locatable" --> R[revealing<br/>placed as streaming preview,<br/>feed per delta]
    D -- "finish(any)" --> F0([forgotten -<br/>never shown])
    R -- "finalCall, valid args<br/>feed(done)" --> OK([hands off to<br/>deciding phase])
    R -- "finalCall, invalid args" --> X1([discard])
    R -- "finish(stopped)<br/>feed(done) + finalize(partial)" --> OK
    R -- "finish(failed)" --> X2([discard])
```

`finish` fires when the exchange ends: a user stop is `"stopped"`, a request
failure is `"failed"`. A normal completion delivered a `finalCall` for every
draft, so the machine is already empty and `finish` is a no-op.

The two endings that matter:

- **Stop keeps.** A user stop freezes a revealing draft at the text streamed
  so far and re-shows it as an ordinary decidable preview. The user watched
  that content arrive; stopping means "that's enough", not "throw it away".
  A rewrite streaming in sentence by sentence (below) keeps what it reads
  as on screen: the sentences it completed, then the original's sentences
  it hadn't reached, which were still plain text - not struck, as the
  streamed text alone would have them. A sentence cut off halfway goes and
  its original stays; with no sentence completed, nothing is kept
  (`pending-edit-plugin`'s `stopRewrite`, applied by
  `useEditorProposals`' `addPreviews` to the re-shown proposal).
- **Failure discards.** The error path offers Retry, and a kept preview
  would duplicate the retried proposal.

Smaller rules the machine also owns:

- A textless proposal (`delete`) still gets its `feed(done)` - without it
  the typewriter entry stays "more may come" forever and the preview never
  becomes decidable.
- Final arguments that don't validate (e.g. `replace` without an anchor)
  discard the placed preview: such a proposal can never be applied, and
  leaving it would strand an un-decidable preview.
- With edit animation off (or reduced motion) the machine is bypassed
  entirely; proposals appear complete, at once, via `ChatBody`'s
  completed-turn batches.

## Deciding phase: `PendingStatus`

`ai/revision/usePendingEdits.ts` + `ai/revision/pending-edit-plugin.ts`.

```mermaid
flowchart LR
    S[streaming] -- "settle: reveal finished<br/>and args final" --> P[pending]
    P -- "Accept / Cmd-Enter" --> A([accepted])
    P -- "Reject / Cmd-Backspace /<br/>superseded by a new exchange" --> J([rejected])
    P -- "doc changed under it" --> I([invalid])
    S -- "doc changed under it" --> I
```

| Status      | Meaning                                      | Behavior                                                                                                   |
| ----------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `streaming` | Args still arriving, or typewriter playing   | Accept refuses (not a failure - works once settled)                                                        |
| `pending`   | Decidable                                    | Strike (red) + new text (green); Quick Ask nav bar walks previews in **document order**, not arrival order |
| `accepted`  | Applied                                      | Decoration removed in the same transaction as the write - no orphan frame                                  |
| `rejected`  | Declined, or superseded                      | Preview removed; chat card shows Rejected                                                                  |
| `invalid`   | Target text changed / anchor no longer found | Preview dropped; chat card offers relocation (asks the model to re-issue against the current document)     |

**Hover only points.** A rewrite decided sentence by sentence pairs each
struck original with its replacement. With the pointer on either side, on
the ✓ / ✕ after them, or on the pair's card in the margin, that pair's
tints turn a shade darker - a darker green for the new text, a darker red
for the original - the way a review note's passage darkens under the
pointer, and its margin card's text darkens with it. The pair the review
bar points at looks the same, card included. There is no outline. The
tints are theme variables (`--revision-*-hover-bg`,
[design-language.md](design-language.md#theme-rules)). That is all hover does, in
every revision view: nothing is hidden, faded or previewed, and the pair
looks as before once the pointer leaves (or leaves the editor). To read
the result without the markup, pick **Result only, no markup** in the
review bar's view menu.

The hover class goes through the plugins, never onto the text's DOM
(`ai/margin/useReviewNotes.ts` → a `hot` meta → `pending-edit-plugin`'s
`hotDecorations`). ProseMirror reads a class written onto a decorated span
as an edit of its own and redraws the paragraph, and every strike and
replacement in it replays its entrance - in `1.1.0-rc.4` that made the red
and the green vanish under the pointer and fade back. The review bar's
**‹ / ›** follow the same rule: the pointer they move is a class the plugin
sets on its widgets (no widget is keyed by it), and the paragraph's flash
(`editor/reveal-position.ts`) is a Web Animation, not a class.

**From the keyboard.** `F7` and `Shift + F7` move the same pointer from
anywhere in the window (`document-view/useReviewBar.ts`) and put the caret
at the change. With the pointer on a sentence, `Ctrl/⌘ + Enter` takes it
and `Ctrl/⌘ + Backspace` (the caret in the proposal) keeps its original,
as its ✓ / ✕ do; with no pointer they accept or reject the whole proposal,
as before. A screen reader hears each step and each decision
(`useRevisionAnnouncements`, `usePendingEdits`' `onDecided`).

**The tint is the text's.** New text over several lines - hard breaks
(`\`, two trailing spaces, `<br>`) or two paragraphs - is tinted line by
line (`renderPendingHtml`'s `.pending-line`), with the breaks between the
lines untinted; one box over all of them painted its padding at every line
end and a stub on the empty line between paragraphs, the darker hover tint
more so. The hover tint over a struck original covers its text runs only
(`textRuns`), never a hard break.

**Motion.** One timing throughout, from `ui/motion.css`: whatever comes in -
a strike, new text, the ✓ / ✕, a sentence a stream completes or moves, what
a view switch brings in - enters over `--dur-base` with `--ease-out`,
opacity only (the ✓ / ✕ also grow from `--scale-enter`); a settled
proposal's sentences follow each other a `--dur-instant` apart, at most
eight steps; tints change over `--dur-instant` (hover) and a decision over
`--dur-fast`. Accepted text fades from green where it now stands over
`--dur-slow` (`.pending-landed`). Reduced motion keeps the fades and drops
the stagger and the growth.

## Revision views

The review bar's view menu (and **Settings › AI**) picks how pending
revisions are drawn, as Word's markup views:

| View                                        | Original    | New text                    |
| ------------------------------------------- | ----------- | --------------------------- |
| **All in the text** (`inline`)              | struck, red | green, with ✓ / ✕           |
| **Original in the text, changes in margin** | struck, red | margin card                 |
| **Changes in the text, original in margin** | margin card | green                       |
| **Result only, no markup** (`final`)        | hidden      | unmarked, faint dotted line |

A rewrite is shown sentence by sentence when its sentences can be found
in the text - also when its anchor spans several paragraphs, which resolve
to their whole blocks (`sentence-locate.ts` skips the text before the
anchor). One that can't be (a heading or list turned into something else)
is shown whole, and the views apply to it as one change with one card.

**The text reads as the result.** Where a view takes the originals out of
the text ("Changes in the text", "Result only"), a block whose text is
all struck and holds no new text - a paragraph the rewrite joins to the
one before it - goes out of the flow with it (`struckBlocks`,
`.pending-struck-block`); left standing it was an empty line with a
paragraph's margins, a blank gap (`1.2.0-rc.1`). One that holds a deleted
sentence's mark keeps its line in "Changes in the text". The margin never
moves the text: cards stack downward and move instead, and a card the
stack pushed below its passage draws its line only while it is under the
pointer or the review bar's pointer - drawn all the time, those lines ran
together down the gap between text and cards as stray strokes.

**Streaming in place.** Such a rewrite is laid out sentence by sentence
while it is still streaming in, not only once it settles
(`sentence-stream.ts`, `pending-edit-plugin`'s `streamDecorations`). Each
completed sentence of the new text is aligned against the original the
way the finished rewrite is (`diffSentenceLists`), except for the last run
of changes, where an original the stream hasn't reached is still to come,
not deleted. So:

- a kept sentence shows nothing; a changed one is struck where it stands
  with its new text beside it the moment it completes, in every view;
- the sentence being written types in beside the original it rewrites,
  which is struck while it is written - or, a sentence of its own, where it
  goes. While it still repeats an original word for word, or is too short
  to tell which one it rewrites, it shows nothing;
- an original is struck only once the stream reaches or passes it, and an
  original once reached is never handed back (`reachedAtLeast`); a
  re-alignment that moves a sentence's new text (a dropped sentence joins
  the change before it) cross-fades it there;
- each completed change's margin card comes with it, and the review bar is
  there from the start of the stream, its count growing one change at a
  time (`streamChanges`, `usePendingEdits`' `reviewed`); ‹ › and the view
  menu already work. In "Original in the text" the sentence being written
  doesn't show in the text - it would only come and go - but in its card
  once complete;
- each completed change's ✓ / ✕ (in the text and on its card) come in
  faint and inert and take clicks once the whole rewrite is in, and so do
  the review bar's Accept and Reject: half a rewrite isn't something to
  take. The AI panel's Stop ends it early, with what it completed.

When the stream ends, the layout is exactly the one the finished proposal
has, on the same elements: nothing is redrawn, nothing moves. The alignment
runs once per completed sentence, on an animation frame; the sentence being
written is placed every frame. A rewrite whose sentences can't be found,
Write's new text and anything with edit animation off stream in as before:
one block, after the struck original.

New text alone - what Write proposes - has no original, so the margin views
have nothing to set beside it: it stays a green block in the text there,
and the view menu says so. In **Result only** it reads as the result.

Every view's parts are always drawn, and the view is an attribute on the
editor (`data-revision-display`, `pending-edit-plugin`'s `syncDisplay`)
that the stylesheet reads. Switching views redraws nothing: what stays is
the same elements at full opacity, and what the new view brings in fades
in briefly (a Web Animation, off with reduced motion). In `1.1.0-rc.6` the
widgets were keyed by the view, so every switch drew them again and the
text came back from nothing. An original the view takes out of the text is
hidden in the flow (`font-size: 0`), not `display: none`, which would start
its entrance over when it came back.

Staleness mirrors the grammar checker: every `docChanged` maps each preview's
range through the transaction and re-checks its text - a mismatch drops the
preview rather than risk applying to the wrong text. Accept re-checks once
more, defensively. Terminal statuses are remembered even after the preview
leaves the document, so a chat card never regresses to a misleading
"Pending".

## Exchange boundaries: consecutive prompts

Four rules, one implementation point (`MilkdownEditor`'s `addPreviews`
wrapper plus a `supersedePending` flag):

1. **A new prompt supersedes.** The FIRST proposal a new exchange writes into
   the document first rejects every preview the user left undecided, then
   places itself. Old and new suggestions never stack.
2. **Question turns don't clear.** The flag is armed when an exchange starts
   and consumed by the first preview add - an exchange that proposes nothing
   leaves existing previews alone.
3. **Same-exchange proposals coexist.** The flag is consumed once; a second
   proposal in the same exchange lands beside the first.
4. **The model is told the truth.** Each send annotates every past
   `propose_edit` tool result in the history with its current status - see
   the next section.

Arming differs per surface: the panel and Quick Ask use their
conversation's `busy` rising edge (each conversation arms on its own); a
detached send never flips that, so it arms via `onContextRequest` - the
fetch-fresh-document signal that precedes every detached send.

## Conversation layer

`ai/chat/useAgentConversation.ts`, `ai/chat/cancelled-turns.ts`,
`ai/revision/proposal-status.ts`, `ai/chat/useRevealedText.ts`; Rust side
`src-tauri/src/ai/agent.rs` / `tools.rs`.

**Every send.** History travels to the backend in full; the document goes
into the system prompt as markdown source (long documents truncate to an
outline plus start/end - the model uses `search_document` for the middle).
The document contains **only accepted edits** - undecided previews are
decorations, absent from it. `annotateProposalStatuses` stamps each past
proposal's tool result with its current status (undecided / accepted /
rejected / invalid), computed fresh per send and never persisted; only call
ids present in the status map are touched, so other tools and
failed-validation proposals pass through unchanged. `agent.rs`'s
instructions tell the model to trust the notes, never anchor to undecided
text, and that proposing new edits replaces undecided ones automatically.

**Stop (user-initiated).** Everything that already streamed is kept: the
completed intermediate turns plus the cut-off reply (as a final Assistant
turn) enter history, saved and displayed like any completed exchange. A
ToolCall the stop left unanswered gets a synthetic result
(`STOPPED_TOOL_RESULT`) - providers reject a replayed history containing an
unanswered tool call. If nothing beyond the user's own message ever
streamed, the whole exchange is dropped (a user message with no reply at all
would read as the model ignoring it).

**Failure.** Sets `error` and `retryable`; Retry resends the same message
verbatim against the document it was composed for. Streamed half-finished
previews are rolled back (writing phase, above).

**Streaming.** Text deltas can arrive several times a frame, and each state
update re-renders the editor that owns the conversation, so a delta only
marks the streaming state dirty and one render per animation frame picks
them all up (`setStreaming` with `textOnly`). Everything else - a landed
turn, the end of the exchange - renders at once. What the chat shows is
paced separately: `ai/chat/useRevealedText.ts` draws the reply through
`ai/stream-reveal.ts`'s `StreamReveal`, a steady pace a little behind the
network, the same pacing the typewriter uses for a proposal in the
document. The end of a stream (finished, stopped or failed) shows the whole
text at once; with reduced motion the reply shows in the steps it arrived.

## Margin availability

The revision views "original" and "new" put one side of each change in the
margin, and review notes are margin cards. Whether there is room is
measured, not assumed (`ai/margin/margin-room.ts`): the text column first
moves left to open a margin, and when even that leaves too little - a
narrow window, both side panels open, a large zoom - there is no margin.
The active document's `ReviewMargin` measures on every resize and writes
the answer to a per-window store (`useMarginAvailable`).

- **The margin views fall back to inline.** With no margin, both sides of
  each change are drawn in the text (`effectiveRevisionDisplay`) and
  review notes go behind numbered badges, which the chat's note cards
  repeat.
- **The chosen view waits and returns.** The setting is not changed: the
  review bar's view button shows what is drawn meanwhile, and the chosen
  view comes back as soon as there is room again.
- **The options say why they are off.** In the review bar's menu and in
  Settings the margin views stay listed but disabled
  (`marginViewBlocked`), with a note to close the sidebar or the AI panel.
  A phone never has a margin, so it lists only the views that need none
  and explains nothing.

## Draft snapshots and closing

`draft-autosave.ts`, `startup-restore.ts`, `App.tsx`.

- **Writing.** A dirty tab's content snapshots to disk 3 s after typing
  settles, at most every 30 s during an unbroken burst. A tab that turns
  clean or leaves the tab list has its snapshot cleared.
- **Closing the last tab** ("Don't Save"): the window dies with it, so the
  autosave hook's cleanup effect never gets another run - `removeTab`
  cancels all scheduled snapshot writes and clears the tab's snapshot
  explicitly BEFORE destroying the window.
- **Closing the whole window** (save or discard): `clearWindowDrafts` also
  cancels scheduled writes first - otherwise a debounce timer firing between
  the clears and `destroy()` re-saves what was just deleted, resurrecting a
  discarded document as a "recovered draft". Only this window's tabs are
  cleared; other windows' drafts survive.
- **Startup**, in priority order: a tab dragged in from another window
  (short-circuits everything), recovered drafts (path-backed drafts whose
  disk content already matches are skipped; never steals focus), a Help doc
  this window was spawned for, OS-handed file paths, first-run onboarding.

## File index

| File                                                                | Owns                                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `ai/revision/proposal-stream.ts`                                    | Writing-phase machine: place/feed/finalize/discard                         |
| `ai/revision/usePendingEdits.ts`                                    | Anchor resolution, accept/reject/rejectAll, status map, review navigation  |
| `ai/revision/pending-edit-plugin.ts`                                | Decorations, hover tint, typewriter + settle, staleness, shortcuts         |
| `ai/revision/sentence-stream.ts`                                    | A rewrite's sentence layout while it streams in                            |
| `ai/revision/proposal-status.ts`                                    | Status notes annotated onto history at send time                           |
| `ai/chat/cancelled-turns.ts`                                        | What a stop keeps; dangling tool-call closure                              |
| `ai/chat/useAgentConversation.ts`                                   | Conversation state: send/stop/retry/restore, history persistence           |
| `ai/stream-reveal.ts`                                               | The pace streamed text is revealed at: the typewriter and chat replies     |
| `ai/chat/useRevealedText.ts`                                        | A chat reply as drawn while it streams, paced by `StreamReveal`            |
| `ai/chat/ChatBody.tsx`                                              | Shared conversation UI; streamed-turn → proposal, idempotent afterSend     |
| `ai/chat/window/ChatWindowApp.tsx`, `ai/chat/window/chat-bridge.ts` | Detached window and its bridge: context/status pushes, proposal forwarding |
| `ai/margin/margin-room.ts`                                          | Whether there is room for a margin; the per-window store both menus read   |
| `ai/revision/revision-display.ts`                                   | The view drawn without a margin; which margin views can't be picked        |
| `document-view/MilkdownEditor.tsx`                                  | Wiring: machine effects, supersede flag, exchange-boundary effect          |
| `draft-autosave.ts`, `startup-restore.ts`, `App.tsx`                | Draft snapshots, startup restore, close-time cleanup                       |
| `src-tauri/src/ai/tools.rs`, `agent.rs`                             | `propose_edit` validation, system prompt, the status-note contract         |
