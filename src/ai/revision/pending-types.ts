import { DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditProposal } from "../types";
import { type SentenceHunk } from "./sentence-diff";
import type { LocatedHunk } from "./sentence-locate";
import { PluginKey } from "@milkdown/kit/prose/state";

/** A proposal in the document: its preview, its sentences and the writer's
 *  call on each, and the plugin state that carries them. */

/** One changed sentence (group) of a rewrite shown sentence by sentence:
 *  where its original stands in the document, what replaces it, and the
 *  writer's call on it - null until they make one (taken on Accept). */
export interface PendingSentence {
  from: number;
  to: number;
  before: string;
  after: string;
  take: boolean | null;
  /** Where each of its original sentences stands, when it has several. */
  parts?: { from: number; to: number }[];
  /** Where its new text goes, when not at `to`: after the sentences it
   *  replaces, before those dropped and joined to it. */
  at?: number;
  /** A block changed whole: [from, to) is its node, its new block drawn
   *  after it. Several whole paragraphs count too, `parts` their nodes. */
  block?: boolean;
  /** Its original's text when found: while `[from, to)` still reads so, the
   *  change stands, whatever the writer did around it. */
  expected?: string;
}

/** One proposal resolved to a document range (`from === to` for `append`).
 *  Anchored ranges cover whole blocks, as only block boundaries have
 *  positions; `replacement` keeps the precise result as Markdown. */
export interface PendingPreview {
  callId: string;
  proposal: EditProposal;
  /** Bumped when a settled proposal's text changes in place, so its widget
   *  is drawn anew rather than kept by its key. */
  revision?: number;
  from: number;
  to: number;
  /** The range's text at resolution time, re-checked on every change before
   *  the preview survives. */
  expectedText: string;
  /** Markdown `[from, to)` becomes on accept, composed in markdown space. */
  replacement: string;
  /** True while its arguments stream in or its text is still being revealed;
   *  cleared by the `settle` meta. */
  streaming?: boolean;
  /** For `replace`/`delete`: a tighter range covering just the removed text.
   *  Absent when it can't be found uniquely, as across blocks. */
  strikeFrom?: number;
  strikeTo?: number;
  /** A rewrite located sentence by sentence: its diff and, per change, its
   *  range and decision. Drawn once settled; absent, it is shown whole. */
  sentences?: {
    hunks: SentenceHunk[];
    changes: PendingSentence[];
    /** Changes whose original the writer has since changed, set aside until
     *  it reads as it did again. */
    parked?: PendingSentence[];
  };
  /** The writer edited the text since: Accept writes its changes one by one,
   *  leaving their edits as they are. */
  rebased?: boolean;
  /** A rewrite's original sentences and where each stands, so it streams in
   *  already in its final place. Absent: it streams in as one block. */
  streamSource?: {
    /** Its units. */
    sentences: string[];
    /** Where each is: its text, or the block node a whole block is. */
    ranges: LocatedHunk[];
  };
  /** A streaming rewrite's completed changes so far, numbered as its settled
   *  `sentences` will be. Set by the plugin, read only while `streaming`. */
  streamChanges?: PendingSentence[];
}

/** Accept's text for a sentence-by-sentence preview: the original with the
 *  changes the writer didn't turn down (undecided ones are taken). */
export function sentenceTake(p: PendingPreview): boolean[] | null {
  return p.sentences ? p.sentences.changes.map((c) => c.take !== false) : null;
}

/** The changes a preview is reviewed by: its sentences once settled, those
 *  drawn so far while streaming, or null when it is shown whole. */
export function reviewChanges(p: PendingPreview): PendingSentence[] | null {
  return (p.streaming ? p.streamChanges : p.sentences?.changes) ?? null;
}

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
  /** The typewriter finished revealing this preview's text: it may now be
   *  decided on. Never dispatched from outside. */
  | { type: "settle"; callId: string }
  /** The writer took (true) or kept the original of (false) one sentence,
   *  or took the call back (null) - the in-text ✓ / ✕ and the card's. */
  | { type: "decide"; callId: string; index: number; take: boolean | null }
  /** The review bar's pointer moved: move its darker tint. */
  | { type: "refocus" }
  /** A streaming rewrite's layout changed. */
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
  /** Accepted proposals with the document before and after: an undo to
   *  `before` offers it again, a redo to `after` takes it away. */
  applied: AppliedEdit[];
  /** The sentence pair under the pointer. */
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

/** The pending-edit plugin's key: its state is every proposal shown. */
export const pendingEditKey = new PluginKey<PendingState>("pending-edit");
