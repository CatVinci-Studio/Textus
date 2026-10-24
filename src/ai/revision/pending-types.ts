import { DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditProposal } from "../types";
import { type SentenceHunk } from "./sentence-diff";
import type { LocatedHunk } from "./sentence-locate";
import { PluginKey } from "@milkdown/kit/prose/state";

/**
 * What a proposal in the document is: its preview, its sentences and the
 * writer's call on each, and the plugin state and meta that carry them
 * (pending-edit-plugin.ts).
 */

/** One changed sentence (group) of a rewrite shown sentence by sentence:
 *  where its original stands in the document, what replaces it, and the
 *  writer's call on it - null until they make one (taken on Accept). */
export interface PendingSentence {
  from: number;
  to: number;
  before: string;
  after: string;
  take: boolean | null;
  /** Where each of its original sentences stands, when it has several -
   *  each struck on its own (`strikeParts`). */
  parts?: { from: number; to: number }[];
  /** Where its new text goes, when not at `to`: after the sentences it
   *  replaces, before those dropped and joined to it (`pairedPrefix`). */
  at?: number;
  /** A block changed whole (markdown-forms.ts's wholeBlockKind: a picture,
   *  a table…): [from, to) is its block node, struck as one, and its new
   *  block is drawn as one after it - not as words in the next paragraph.
   *  Several whole paragraphs changed as one (pending-place.ts's
   *  wholeParagraphs) are a block change too, `parts` their nodes. */
  block?: boolean;
  /** Its original's text (`visibleTextBetween`) when it was found: while
   *  `[from, to)` still reads so, the change stands, whatever the writer
   *  did around it (`rebase`). */
  expected?: string;
}

/**
 * One propose_edit tool call, resolved to a live document range (see
 * usePendingEdits.ts, which does the resolution in markdown space via
 * doc-markdown.ts - this plugin only renders and tracks staleness, it never
 * resolves anchors itself). `from === to` for `append`.
 *
 * For anchored actions the range covers the WHOLE blocks the anchor touches,
 * not just the quoted snippet: a markdown offset inside a block has no
 * ProseMirror position, a block boundary does. `replacement` carries the
 * precise, sub-block-accurate result as markdown, so nothing is lost - only
 * the decorated (and re-parsed) range is coarse.
 */
export interface PendingPreview {
  callId: string;
  proposal: EditProposal;
  /** Bumped when a settled proposal's text changes in place (a picture
   *  joining it, usePendingEdits' joinPicture): its widget is drawn anew
   *  rather than kept, as its key otherwise keeps it. */
  revision?: number;
  from: number;
  to: number;
  /** The range's text (`visibleTextBetween`, link-reveal.ts: a link shown
   *  as its source reads as its text) at resolution time - the ground
   *  truth a later docChanged re-checks before letting the preview
   *  survive. */
  expectedText: string;
  /** Markdown `[from, to)` becomes on accept, composed in markdown space. */
  replacement: string;
  /** True while the proposal isn't ready to be decided on: its arguments
   *  are still streaming in (`replacement` incomplete - accept refuses), or
   *  the typewriter is still revealing the text in the document (offering
   *  Accept before the content is even visible was the complaint this
   *  covers). Cleared by the plugin's `settle` meta once the reveal
   *  finishes; surfaced to the UI as the "streaming" PendingStatus. */
  streaming?: boolean;
  /** For `replace`/`delete`: a tighter range within [from, to) covering
   *  just the text actually being removed, located via its rendered PLAIN
   *  TEXT (text-locate.ts) rather than the block-boundary-snapped
   *  [from, to) - see usePendingEdits.ts's computeStrikeRange. Absent
   *  (falls back to the whole [from, to) range) whenever that couldn't be
   *  determined uniquely - e.g. the anchor spans more than one block. */
  strikeFrom?: number;
  strikeTo?: number;
  /** A rewrite located sentence by sentence (sentence-locate.ts): the whole
   *  sentence diff (what Accept composes from) and, per change, its range
   *  and decision. Drawn once the preview settles - while it streams, the
   *  layout comes from `streamSource`. Absent: shown and decided whole. */
  sentences?: {
    hunks: SentenceHunk[];
    changes: PendingSentence[];
    /** Changes whose original the writer has since changed: set aside,
     *  not shown or applied - and back among `changes` if the original
     *  reads as it did again (an undo). */
    parked?: PendingSentence[];
  };
  /** The writer edited the text since this was proposed (`rebase`):
   *  Accept writes its changes one by one, leaving everything else in
   *  `[from, to)` - their edits - as it now is. */
  rebased?: boolean;
  /** A rewrite whose original could be found sentence by sentence: those
   *  sentences (markdown) and where each stands. While it streams, its new
   *  text is laid out against them a sentence at a time
   *  (sentence-stream.ts), so it is already in its final place when it
   *  settles. Absent: it streams in as one block after the struck original. */
  streamSource?: {
    /** Its units (sentence-diff.ts's splitUnits). */
    sentences: string[];
    /** Where each is: its text, or the block node a whole block is. */
    ranges: LocatedHunk[];
  };
  /** The changes of a rewrite streaming in sentence by sentence that are
   *  complete and drawn so far (streamDecorations), numbered as its
   *  settled `sentences` will be: what the review bar counts and the
   *  margin shows while it streams, one more as each sentence completes.
   *  Set by the plugin, read only while `streaming`. */
  streamChanges?: PendingSentence[];
}

/** Accept's text for a sentence-by-sentence preview: the original with the
 *  changes the writer didn't turn down (undecided ones are taken). */
export function sentenceTake(p: PendingPreview): boolean[] | null {
  return p.sentences ? p.sentences.changes.map((c) => c.take !== false) : null;
}

/** The changes a preview is reviewed by - its sentences once settled,
 *  those drawn so far while it streams in - or null when it is shown
 *  whole. A streaming rewrite's final sentences, there while its text is
 *  still being revealed, wait their turn: they would count changes not
 *  on screen yet. */
export function reviewChanges(p: PendingPreview): PendingSentence[] | null {
  return (p.streaming ? p.streamChanges : p.sentences?.changes) ?? null;
}

// --- Typewriter reveal for the green pending-insert widget --------------
//
// The animation state lives OUTSIDE the widget DOM, keyed by callId,
// because the two have different lifetimes in both directions: streamed
// text arrives before the widget exists (the plugin add that creates it is
// dispatched in the same tick), and the widget DOM survives decoration
// rebuilds (via the widget `key`) including the final add that replaces a
// streaming preview - whose toDOM is then never called.

export type PendingMeta =
  | { type: "add"; previews: PendingPreview[] }
  /** `applied`: Accept put the proposal into the document in the same
   *  transaction - kept so an undo can bring the proposal back. */
  | {
      type: "remove";
      callId: string;
      applied?: boolean;
      /** Where Accept wrote the new text, for its green to fade out from
       *  (`landed`). */
      landed?: { from: number; to: number }[];
    }
  | { type: "clear" }
  /** The typewriter finished revealing this preview's text - it may now be
   *  decided on (dispatched by maybeSettle, never from outside). */
  | { type: "settle"; callId: string }
  /** The writer took (true) or kept the original of (false) one sentence,
   *  or took the call back (null) - the in-text ✓ / ✕ and the card's. */
  | { type: "decide"; callId: string; index: number; take: boolean | null }
  /** The review bar's pointer moved: move its darker tint. */
  | { type: "refocus" }
  /** A rewrite streaming in sentence by sentence changed its layout: a
   *  sentence completed, or the one being written moved (refreshStream). */
  | { type: "relayout"; callId: string }
  /** The pointer is on a changed sentence or its margin card (null: on
   *  none) - the pair's tints darken, nothing else changes. */
  | { type: "hot"; sentence: HotSentence | null };

/** A changed sentence of a sentence-by-sentence preview. */
export interface HotSentence {
  callId: string;
  index: number;
}

export interface PendingState {
  previews: PendingPreview[];
  decoration: DecorationSet;
  /** Accepted proposals, with the document before and after the accept:
   *  an undo back to `before` puts the proposal on offer again (its card
   *  had kept saying "Applied" over the restored text), a redo back to
   *  `after` takes it away again. */
  applied: AppliedEdit[];
  /** The sentence pair under the pointer (see `hotDecorations`). */
  hot: HotSentence | null;
  /** The text the last Accept wrote: its green fades out there
   *  (`.pending-landed`) instead of vanishing with the preview. Gone with
   *  the next edit. */
  landed: { from: number; to: number }[];
}

export interface AppliedEdit {
  preview: PendingPreview;
  before: ProseNode;
  after: ProseNode;
  /** Undone: the preview is on offer again. */
  undone: boolean;
}

/** The pending-edit plugin's key (pending-edit-plugin.ts): its state is
 *  every proposal shown in the document. */
export const pendingEditKey = new PluginKey<PendingState>("pending-edit");
