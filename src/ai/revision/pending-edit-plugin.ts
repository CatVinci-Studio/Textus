import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { isHistoryTransaction } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { renderMarkdownInlineHtml } from "../../editor/markdown/render-html";
import { onKatexReady } from "../../editor/math/katex-loader";
import {
  pendingDiagram,
  splitMermaidFences,
} from "../../editor/pending-diagram";
import { StreamReveal } from "../stream-reveal";
import {
  animate as animateElement,
  prefersReducedMotion,
} from "../../ui/motion";
import type { FoldAttention } from "../../editor/html/details-fold";
import type { EditProposal } from "../types";
import { showGeneratedImages } from "./generated-images";
import {
  pairedPrefix,
  splitSentences,
  trimBreaks,
  type SentenceHunk,
} from "./sentence-diff";
import {
  alignCompleted,
  partialFor,
  type StreamLayout,
} from "./sentence-stream";
import type { RevisionDisplay } from "../../settings/SettingsContext";

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
  from: number;
  to: number;
  /** `doc.textBetween(from, to, " ")` at resolution time - the ground truth
   *  a later docChanged re-checks before letting the preview survive. */
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
  sentences?: { hunks: SentenceHunk[]; changes: PendingSentence[] };
  /** A rewrite whose original could be found sentence by sentence: those
   *  sentences (markdown) and where each stands. While it streams, its new
   *  text is laid out against them a sentence at a time
   *  (sentence-stream.ts), so it is already in its final place when it
   *  settles. Absent: it streams in as one block after the struck original. */
  streamSource?: {
    sentences: string[];
    ranges: { from: number; to: number }[];
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

interface InsertAnimation {
  callId: string;
  /** Full text known so far - grows while the proposal streams. */
  target: string;
  /** Paces `target` onto the screen (stream-reveal.ts). */
  reveal: StreamReveal;
  /** False while more streamed text may still arrive (keeps the caret). */
  done: boolean;
  span: HTMLSpanElement | null;
  frame: number | null;
  /** The view that drew the widget - the reveal's only way to dispatch the
   *  `settle` meta that finally offers Accept/Reject for this preview. */
  view: EditorView | null;
  /** The settle meta was dispatched - never dispatch it twice. */
  settled: boolean;
  /** Set when the text is laid out sentence by sentence as it streams
   *  (PendingPreview.streamSource); `span` is then only the sentence being
   *  written. */
  stream: StreamState | null;
}

/** A rewrite being laid out sentence by sentence while it streams. */
interface StreamState {
  /** The original's sentences (markdown). */
  sentences: string[];
  layout: StreamLayout;
  /** The completed text `layout.pieces` were aligned for: the alignment
   *  only runs again when a sentence completes, not on every frame. */
  alignedFor: string | null;
  /** The most originals the stream has reached: a later layout never
   *  hands one back (sentence-stream.ts's `reachedAtLeast`). */
  reached: number;
  /** `layoutSignature` of the layout the decorations were last built
   *  from: a different one asks for a rebuild (`relayout`). */
  drawn: string;
  relayoutQueued: boolean;
  /** The new text each change's widget was drawn with, by change index -
   *  what tells a sentence just completed (the partial span already showed
   *  it: no entrance) from one a re-alignment changed (a cross-fade). */
  shown: Map<number, { after: string; at: number }>;
  /** The change index the sentence being written was drawn as. */
  partialIndex: number | null;
  /** The struck originals whose strike has drawn in (drawStrikesIn). */
  struck: Set<string>;
  /** Set once stopped mid-stream: the text it keeps (stopRewrite). */
  stopped?: string | null;
  /** The completed changes as last drawn (PendingPreview.streamChanges). */
  changes: PendingSentence[];
}

const animations = new Map<string, InsertAnimation>();

function newAnimation(
  callId: string,
  text: string,
  done: boolean,
): InsertAnimation {
  const reveal = new StreamReveal();
  reveal.update(text, done, performance.now());
  return {
    callId,
    target: text,
    reveal,
    done,
    span: null,
    frame: null,
    view: null,
    settled: false,
    stream: null,
  };
}

/** The layout's shape - what decides whether the decorations must be
 *  rebuilt; the partial sentence's growing text is not part of it (its span
 *  is updated in place). */
function layoutSignature(layout: StreamLayout): string {
  const pieces = layout.pieces
    .map((p) =>
      p.kind === "same"
        ? `s${p.start}`
        : `c${p.start}-${p.end}:${textKey(p.after)}`,
    )
    .join(",");
  const partial = layout.partial
    ? `${layout.partial.rewrites ?? "i"}@${layout.partial.at}`
    : "-";
  return `${pieces}|${partial}`;
}

/** A short, stable key for a widget's text: a widget with the same key is
 *  kept as it is, so its key has to change with what it shows. */
function textKey(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++)
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * The streaming rewrite's layout for what is on screen now (the reveal's
 * text, not what has arrived): completed sentences are aligned when one
 * completes, the sentence being written is placed every frame. Asks for a
 * rebuild when the shape changed.
 */
function refreshStream(anim: InsertAnimation) {
  const s = anim.stream;
  if (!s) return;
  const done = anim.done && anim.reveal.caughtUp;
  const pieces = splitSentences(anim.reveal.text);
  const completed = done ? pieces : pieces.slice(0, -1);
  const key = `${done ? 1 : 0}${completed.join("")}`;
  let { pieces: aligned, reached } = s.layout;
  if (key !== s.alignedFor) {
    ({ pieces: aligned, reached } = alignCompleted(
      s.sentences,
      completed,
      done,
      s.reached,
    ));
    s.alignedFor = key;
    // Done reaches every original; a stop's text is laid out against what
    // the stream itself had reached.
    if (!done) s.reached = Math.max(s.reached, reached);
  }
  s.layout = {
    pieces: aligned,
    reached,
    partial: done
      ? null
      : partialFor(s.sentences, (pieces.at(-1) ?? "").trim(), reached),
  };
  if (layoutSignature(s.layout) !== s.drawn) queueRelayout(anim);
}

/** Rebuilds the decorations from the new layout - after the current
 *  dispatch (this is reached from inside a decoration draw too), but before
 *  the frame is painted. */
function queueRelayout(anim: InsertAnimation) {
  const s = anim.stream;
  const view = anim.view;
  if (!s || !view || s.relayoutQueued) return;
  s.relayoutQueued = true;
  queueMicrotask(() => {
    s.relayoutQueued = false;
    if (view.isDestroyed || animations.get(anim.callId) !== anim) return;
    view.dispatch(
      view.state.tr.setMeta(pendingEditKey, {
        type: "relayout",
        callId: anim.callId,
      }),
    );
  });
}

function updateAnimation(anim: InsertAnimation, text: string, done: boolean) {
  anim.target = text;
  anim.done = done;
  anim.reveal.update(text, done, performance.now());
}

/** Whether the callId's text is still being revealed (or may still grow) -
 *  while true, the preview must stay in the un-decidable "streaming" state
 *  even after the final proposal arguments have landed. */
function stillRevealing(callId: string): boolean {
  const anim = animations.get(callId);
  if (!anim) return false;
  // Nothing to type out - once the arguments are final. A `delete` proposes
  // no text, so no green insert widget is ever drawn for it and no reveal
  // can ever complete: reporting "still revealing" after its final feed
  // would strand the preview in `streaming` for good (settle can only be
  // dispatched by a widget that doesn't exist), and a preview that never
  // becomes decidable never gets an accept/reject bar. While the stream is
  // still open, though, an empty text only means its first characters
  // haven't arrived: a draft placed right after `"text": "` used to settle
  // there and then, became decidable mid-stream, and - settling only once -
  // stayed "Writing…" forever when the final proposal landed mid-reveal.
  if (anim.target.length === 0) return !anim.done;
  return !anim.done || !anim.reveal.caughtUp;
}

/** Once the reveal completes, flips the preview out of `streaming` via a
 *  plugin meta so Accept/Reject finally show. Deferred a tick: this is
 *  reached from animation frames but also from inside decoration draws,
 *  where a reentrant dispatch is not allowed. */
function maybeSettle(callId: string) {
  const anim = animations.get(callId);
  if (!anim || anim.settled || stillRevealing(callId)) return;
  const view = anim.view;
  if (!view) return; // no widget drawn yet - its toDOM will retry
  anim.settled = true;
  window.setTimeout(() => {
    if (view.isDestroyed) return;
    view.dispatch(
      view.state.tr.setMeta(pendingEditKey, { type: "settle", callId }),
    );
  }, 0);
}

function stopFrame(anim: InsertAnimation) {
  if (anim.frame !== null) {
    cancelAnimationFrame(anim.frame);
    anim.frame = null;
  }
}

function renderAnimation(anim: InsertAnimation) {
  if (!anim.span) return;
  // Re-parses the growing revealed prefix every tick, not just the final
  // text: a partial markdown token (an unclosed "**") can render as its
  // literal characters for a frame until it closes, then flip to real
  // formatting - a small, expected artifact of live-formatting a stream,
  // not a bug (every streaming markdown renderer has it). Preferred over
  // revealing raw source and snapping to formatted HTML only once done,
  // which pops the widget's width/wrapping at the very end instead.
  renderPendingHtml(
    anim.span,
    anim.stream
      ? trimBreaks(anim.stream.layout.partial?.text ?? "")
      : anim.reveal.text,
  );
  anim.span.classList.toggle(
    "pending-insert-typing",
    !anim.reveal.caughtUp || !anim.done,
  );
}

/**
 * New text into its widget, as rendered Markdown. With line breaks in it
 * (a hard break, or the blank line between two paragraphs), each line goes
 * into a span of its own that carries the tint (`pending-insert-lines`),
 * and the breaks stand between them untinted: one inline box over several
 * lines painted its padding at every line end and a stub of colour on an
 * empty line, and the darker hover tint, a box per line, more so. A
 * ```mermaid fence stands between the lines too, as its diagram.
 */
function renderPendingHtml(span: HTMLElement, markdown: string) {
  fillPendingHtml(span, markdown);
  if (span.querySelector(".math-pending")) awaitKatex(span, markdown);
  else waitingForKatex.delete(span);
}

// The widgets showing a formula's source while KaTeX loads (katex-loader.ts),
// with the markdown each shows. A widget is kept by its key across
// transactions, so nothing else would draw it again once KaTeX is here: it
// would show the source until the proposal next changed.
const waitingForKatex = new Map<HTMLElement, string>();

function awaitKatex(span: HTMLElement, markdown: string) {
  if (waitingForKatex.size === 0)
    onKatexReady(() => {
      for (const [waiting, text] of waitingForKatex)
        if (waiting.isConnected) fillPendingHtml(waiting, text);
      waitingForKatex.clear();
    });
  waitingForKatex.set(span, markdown);
}

function fillPendingHtml(span: HTMLElement, source: string) {
  // A proposed picture (generate_image) is drawn from its bytes, which
  // only the preview holds.
  const markdown = showGeneratedImages(source);
  const parts = splitMermaidFences(markdown);
  let nodes: Node[];
  if (!parts) {
    span.innerHTML = renderMarkdownInlineHtml(markdown);
    nodes = [...span.childNodes];
  } else {
    // A ```mermaid fence is drawn as its diagram, in a box of its own
    // between the lines (pending-diagram.ts). The same fence keeps its
    // element across the typewriter's frames, and with it its drawing.
    const previous = span.querySelectorAll<HTMLElement>(".pending-diagram");
    let diagrams = 0;
    nodes = parts.flatMap((part) => {
      if (part.kind === "diagram")
        return [pendingDiagram(part, previous[diagrams++])];
      const html = document.createElement("template");
      html.innerHTML = renderMarkdownInlineHtml(part.text);
      return [...html.content.childNodes];
    });
  }
  const lines = !!parts || nodes.some((n) => n.nodeName === "BR");
  span.classList.toggle("pending-insert-lines", lines);
  if (!lines) return;
  span.textContent = "";
  let line: HTMLElement | null = null;
  for (const node of nodes) {
    const blank = node.nodeType === Node.TEXT_NODE && !node.textContent?.trim();
    const diagram =
      node instanceof HTMLElement && node.classList.contains("pending-diagram");
    if (node.nodeName === "BR" || diagram || (blank && !line)) {
      span.append(node);
      line = null;
      continue;
    }
    if (!line) {
      line = document.createElement("span");
      line.className = "pending-line";
      span.append(line);
    }
    line.append(node);
  }
}

/** Types the text out a frame at a time until it has caught up with what
 *  has arrived; the next fragment starts it again. */
function ensureTicking(anim: InsertAnimation) {
  // Laid out sentence by sentence, the reveal runs with no span at all:
  // between sentences, or while one repeats its original, none is drawn.
  if (anim.frame !== null) return;
  if (anim.stream ? !anim.view : anim.span === null) return;
  if (anim.reveal.caughtUp) {
    refreshStream(anim);
    renderAnimation(anim);
    return;
  }
  const step = (now: number) => {
    anim.reveal.tick(now);
    refreshStream(anim);
    renderAnimation(anim);
    if (!anim.reveal.caughtUp) {
      anim.frame = requestAnimationFrame(step);
      return;
    }
    anim.frame = null;
    maybeSettle(anim.callId);
  };
  anim.frame = requestAnimationFrame(step);
}

function dropAnimation(callId: string) {
  const anim = animations.get(callId);
  if (!anim) return;
  stopFrame(anim);
  animations.delete(callId);
}

/**
 * Feeds streamed propose_edit text into the callId's green widget - called
 * by the editor (MilkdownEditor's stream-event handler) as `text` argument
 * fragments arrive, and once more with `done` when the call completes. The
 * widget picks the state up whenever it's created relative to this.
 */
export function streamPendingInsertText(
  callId: string,
  text: string,
  done: boolean,
) {
  const existing = animations.get(callId);
  if (!existing) {
    animations.set(callId, newAnimation(callId, text, done));
    return;
  }
  // `done` goes both directions: a widget drawn from an early streaming
  // preview creates the entry with done=true (it can't know more text is
  // coming) - the next stream call must be able to reopen it, or the
  // reveal settles mid-stream.
  updateAnimation(existing, text, done);
  ensureTicking(existing);
  renderAnimation(existing);
  maybeSettle(callId);
}

/**
 * What a rewrite stopped mid-stream keeps, when it was being laid out
 * sentence by sentence: the sentences it completed, then the original's
 * sentences it hadn't reached yet - as it reads on screen, where those are
 * still plain. A sentence cut off halfway goes, and its original stays: half
 * a sentence is not a revision anyone would take. Null when no sentence was
 * completed (nothing to keep), undefined when it wasn't laid out by
 * sentence (`text` is kept as it is).
 */
export function stopRewrite(
  callId: string,
  text: string,
): string | null | undefined {
  const s = animations.get(callId)?.stream;
  if (!s) return undefined;
  s.stopped ??= keptOnStop(s, text);
  return s.stopped;
}

/** What `stopRewrite` kept of the callId's rewrite - also for the re-add
 *  the conversation makes of the stopped turn, which carries the text as it
 *  streamed. Undefined when it wasn't stopped or not laid out by sentence. */
export function stoppedRewrite(callId: string): string | null | undefined {
  return animations.get(callId)?.stream?.stopped;
}

function keptOnStop(s: StreamState, text: string): string | null {
  const pieces = splitSentences(text);
  const last = pieces.at(-1) ?? "";
  // Stopped right after a sentence's stop: that one is complete.
  if (!/[。！？!?.;；][”’"')）」』\]]*\s*$/.test(last)) pieces.pop();
  if (pieces.length === 0) return null;
  const { reached } = alignCompleted(s.sentences, pieces, false, s.reached);
  const kept = pieces.join("");
  const rest = s.sentences.slice(reached).join("");
  if (!rest) return kept;
  // The space the original had between the two, if the kept text ends
  // without one.
  const gap = /\s$/.test(kept)
    ? ""
    : (s.sentences[reached - 1]?.match(/\s*$/)?.[0] ?? "");
  return kept + gap + rest;
}

type PendingMeta =
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

interface PendingState {
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

interface AppliedEdit {
  preview: PendingPreview;
  before: ProseNode;
  after: ProseNode;
  /** Undone: the preview is on offer again. */
  undone: boolean;
}

/** Accepts remembered for undo - older ones are rarely undone that far. */
const MAX_APPLIED = 20;

/** An undo or redo landing exactly on an accept's before or after: the
 *  preview comes back or goes again. Null when nothing matched. */
function replayHistory(
  tr: Transaction,
  prev: PendingState,
): { previews: PendingPreview[]; applied: AppliedEdit[] } | null {
  if (!isHistoryTransaction(tr) || prev.applied.length === 0) return null;
  const back: PendingPreview[] = [];
  const gone = new Set<string>();
  const applied = prev.applied.map((entry) => {
    if (!entry.undone && tr.doc.eq(entry.before)) {
      back.push(entry.preview);
      return { ...entry, undone: true };
    }
    if (entry.undone && tr.doc.eq(entry.after)) {
      gone.add(entry.preview.callId);
      return { ...entry, undone: false };
    }
    return entry;
  });
  if (back.length === 0 && gone.size === 0) return null;
  // The others move with the undo, as with any edit; the restored ones were
  // recorded against exactly this document.
  const others = mapPreviews(
    prev.previews.filter(
      (p) => !gone.has(p.callId) && !back.some((b) => b.callId === p.callId),
    ),
    tr,
  ).survivors;
  return { previews: [...others, ...back], applied };
}

/** The call ids accepted and not undone - what the cards show as applied. */
export function appliedCallIds(state: EditorState): string[] {
  return (pendingEditKey.getState(state)?.applied ?? [])
    .filter((entry) => !entry.undone)
    .map((entry) => entry.preview.callId);
}

export const pendingEditKey = new PluginKey<PendingState>("pending-edit");

export function hasPendingEdits(state: EditorState): boolean {
  return (pendingEditKey.getState(state)?.previews.length ?? 0) > 0;
}

function textWidget(
  p: PendingPreview,
  pos: number,
  side: -1 | 1,
  animate: boolean,
  replaces: boolean,
) {
  return Decoration.widget(
    pos,
    (view) => {
      const span = document.createElement("span");
      // `pending-replaces`: there is an original, which the margin views
      // can show instead. New text alone (Write) has none, and stays in
      // the text, green, in every view but "final".
      span.className = `pending-insert pending-whole${replaces ? " pending-replaces" : ""}`;
      // Read as an insertion, not as text of the document.
      span.setAttribute("role", "insertion");
      span.contentEditable = "false";
      span.dataset.call = p.callId;
      span.dataset.index = "-1";
      const text = p.proposal.text ?? "";
      // A picture comes in whole: typed out, its Markdown would show
      // character by character first.
      if (!animate || prefersReducedMotion() || p.proposal.image) {
        renderPendingHtml(span, text);
        return span;
      }
      let anim = animations.get(p.callId);
      if (!anim) {
        anim = newAnimation(p.callId, text, !p.streaming);
        animations.set(p.callId, anim);
      } else if (text.length > anim.target.length) {
        // The final proposal's text wins over whatever partial state the
        // stream left behind; a shorter re-add never truncates the target.
        updateAnimation(anim, text, anim.done);
      }
      anim.span = span;
      anim.view = view;
      renderAnimation(anim);
      ensureTicking(anim);
      maybeSettle(p.callId);
      return span;
    },
    {
      side,
      part: "text",
      // Decorations are rebuilt wholesale on every docChanged; the key
      // makes ProseMirror keep the DOM node across rebuilds, so the
      // typewriter isn't restarted by unrelated keystrokes.
      key: `pending-insert-${p.callId}`,
      destroy: (node) => {
        const anim = animations.get(p.callId);
        if (anim && anim.span === node) {
          anim.span = null;
          stopFrame(anim);
        }
      },
    },
  );
}

/**
 * One preview's decorations: a struck-through/red-tinted `.pending-delete`
 * span over the text being removed, plus a green `.pending-insert`
 * ghost-text widget carrying the new markdown - shown as source text, not
 * parsed nodes, because parsing only happens once (on accept, via
 * apply-edit.ts's parserCtx path) to avoid a second, divergent render path.
 *
 * The widget shows `proposal.text` (what the model actually wrote) rather
 * than the full `replacement`, which for a sub-block edit would repeat the
 * untouched prefix/suffix back at the reader.
 *
 * `strikeFrom`/`strikeTo`, when present, narrow the strike (and the
 * `replace` widget's anchor point) from the whole re-parsed block down to
 * just the actually-changed text - see PendingPreview's doc comment. `p.to`
 * remains the fallback for BOTH the strike extent and the widget position:
 * a struck whole block with the new text tacked on at its very end is a
 * safe, if coarser, degradation of the same "old text struck, new text
 * follows immediately" reading.
 */
const CHECK_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
const CROSS_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

export interface SentencePickLabels {
  take: string;
  keep: string;
}

/**
 * A sentence-by-sentence preview: each changed sentence struck where it
 * stands, its replacement right after it, and a ✓ / ✕ pair to take it or
 * keep the original. Kept sentences read as the original again (the new
 * text dims and is struck instead). Unchanged sentences get nothing.
 *
 * Every view's parts are drawn whatever the view: the struck original, the
 * new text, the ✓ / ✕ and the marks where a pure insertion or deletion
 * stands. The view is an attribute on the editor (`syncDisplay`) and the
 * stylesheet shows the parts it needs, so switching views redraws nothing:
 * a widget keyed by the view was drawn again on every switch, and the text
 * came back from nothing (1.1.0-rc.6).
 *
 * The widgets' keys carry the decision, so a decision redraws them and
 * their CSS entrance runs as the change of state; `--i` staggers the
 * first appearance sentence by sentence.
 */
function sentenceDecorations(
  p: PendingPreview,
  changes: PendingSentence[],
  hooks: SentenceHooks,
): Decoration[] {
  const labels = hooks.labels();
  const focused = hooks.focused();
  // Streamed in sentence by sentence: its parts are on screen already, so
  // its settled decorations match them (no stagger), and only its ✓ / ✕
  // change: they start taking clicks.
  const streamed = !!animations.get(p.callId)?.stream;
  return changes.flatMap((c, index) =>
    changeDecorations(p.callId, index, c, {
      focused: focused?.callId === p.callId && focused.index === index,
      stagger: streamed ? 0 : index,
      labels,
      decide: hooks.decide,
    }),
  );
}

/** How one change is drawn: settled (with its ✓ / ✕), or while its
 *  rewrite still streams in (`stream`). */
interface ChangeDraw {
  focused: boolean;
  stagger: number;
  labels: SentencePickLabels;
  /** Only reached once settled: a streaming rewrite's ✓ / ✕ take no
   *  clicks, and it has no sentences to decide yet anyway. */
  decide: SentenceHooks["decide"];
  stream?: StreamState;
}

function changeDecorations(
  callId: string,
  index: number,
  c: Pick<PendingSentence, "from" | "to" | "after" | "take" | "parts" | "at">,
  draw: ChangeDraw,
): Decoration[] {
  const decos: Decoration[] = [];
  const state = c.take === false ? "kept" : c.take === true ? "taken" : "open";
  const stagger = `--i: ${draw.stagger}`;
  const focus = draw.focused ? " pending-sentence-focus" : "";
  // Sentence by sentence, and the space between them: a sentence a stream
  // later finds dropped and joins to this change is struck beside the
  // others, which stay as they are - one decoration over all of them was a
  // new one, and the strike drew in again over the sentences already
  // struck.
  if (c.from < c.to)
    for (const part of strikeParts(c))
      decos.push(sentenceStrike(callId, index, part, state, focus, stagger));
  // The new text and its ✓ / ✕: after the sentences it replaces.
  const at = c.at ?? c.to;
  // While the rewrite streams in, everything a change will have once it
  // settles is drawn already, so the settle moves nothing: the ✓ / ✕ faint
  // and inert (`pending-streaming`, which syncStreaming takes off).
  const streaming = draw.stream ? " pending-streaming" : "";
  const mark = (kind: "insert" | "delete") =>
    Decoration.widget(
      c.to,
      () => {
        const el = document.createElement("span");
        el.className = `pending-${kind}-mark pending-sentence-${state}${streaming}`;
        el.dataset.call = callId;
        el.dataset.index = String(index);
        return el;
      },
      {
        side: 1,
        key: `pending-mark-${kind}-${callId}-${index}-${state}`,
        part: kind === "delete" ? "mark" : undefined,
      },
    );
  // Where a pure insertion goes, for the views that leave its new text
  // to the margin ("original").
  if (c.from === c.to) decos.push(mark("insert"));
  // The line break a sentence ends with stays the original's, in the text.
  const after = trimBreaks(c.after);
  if (after) {
    const key = `pending-new-${callId}-${index}-${state}-${textKey(after)}`;
    decos.push(
      Decoration.widget(
        at,
        () => {
          const span = document.createElement("span");
          span.className = `pending-insert pending-sentence-new pending-sentence-${state}${focus}`;
          if (state !== "kept") span.setAttribute("role", "insertion");
          span.contentEditable = "false";
          span.dataset.call = callId;
          span.dataset.index = String(index);
          span.setAttribute("style", stagger);
          renderPendingHtml(span, after);
          if (draw.stream) streamEntrance(span, draw.stream, index, after, at);
          else if (animations.get(callId)?.stream)
            // Streamed, and drawn again only because its place moved a
            // character at the settle: what it shows is already on screen.
            span.classList.add("pending-settled");
          return span;
        },
        { side: 1, key, part: "text" },
      ),
    );
  }
  // Where a deleted sentence was, for the views that leave the original
  // to the margin ("new").
  else decos.push(mark("delete"));
  const { labels, decide } = draw;
  decos.push(
    Decoration.widget(
      at,
      () => {
        const pick = document.createElement("span");
        pick.className = `pending-pick pending-pick-${state}${streaming}`;
        pick.contentEditable = "false";
        pick.dataset.call = callId;
        pick.dataset.index = String(index);
        pick.setAttribute("style", stagger);
        const button = (take: boolean) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = take ? "pending-pick-take" : "pending-pick-keep";
          b.innerHTML = take ? CHECK_SVG : CROSS_SVG;
          const label = take ? labels.take : labels.keep;
          b.title = label;
          b.setAttribute("aria-label", label);
          b.setAttribute("aria-pressed", String(c.take === take));
          // The caret stays where it was: a click here decides, it
          // doesn't move into the text.
          b.addEventListener("mousedown", (e) => e.preventDefault());
          b.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            decide(callId, index, c.take === take ? null : take);
          });
          return b;
        };
        pick.append(button(true), button(false));
        return pick;
      },
      {
        side: 2,
        key: `pending-pick-${callId}-${index}-${state}`,
        ignoreSelection: true,
        stopEvent: () => true,
      },
    ),
  );
  return decos;
}

/** The ranges a change strikes: each original sentence, and the space
 *  between two of them. */
function strikeParts(
  c: Pick<PendingSentence, "from" | "to" | "parts">,
): { from: number; to: number }[] {
  const parts = c.parts;
  if (!parts || parts.length < 2) return [{ from: c.from, to: c.to }];
  const out: { from: number; to: number }[] = [];
  parts.forEach((part, i) => {
    const next = parts[i + 1];
    out.push(part);
    if (next && part.to < next.from) out.push({ from: part.to, to: next.from });
  });
  return out;
}

/** A changed sentence's original, struck. The same attributes while it
 *  streams and once settled, so the settle leaves the span as it is. */
function sentenceStrike(
  callId: string,
  index: number,
  range: { from: number; to: number },
  state: string,
  focus: string,
  stagger: string,
): Decoration {
  // Streamed in: its strike draws in from the plugin view (`drawStrikesIn`),
  // not from CSS - ProseMirror may draw a span again as the sentences
  // around it change, and a CSS entrance played again each time.
  const streamed = animations.get(callId)?.stream ? " pending-streamed" : "";
  return Decoration.inline(
    range.from,
    range.to,
    {
      class: `pending-delete pending-sentence pending-sentence-${state}${focus}${streamed}`,
      // What a screen reader announces as deleted; a sentence kept as
      // written is the document's text again.
      ...(state === "kept" ? {} : { role: "deletion" }),
      style: stagger,
      "data-call": callId,
      "data-index": String(index),
    },
    { part: state === "kept" ? undefined : "struck" },
  );
}

/**
 * How a completed sentence's new text comes in while the rewrite streams.
 * The sentence the partial span was just writing is already on screen as it
 * is: no entrance. One a re-alignment changed or moved - a sentence the
 * rewrite dropped joins the change before it, whose new text then follows
 * it - or one that appears without having been written in place (it
 * repeated its original until its last word), cross-fades in.
 */
function streamEntrance(
  span: HTMLElement,
  s: StreamState,
  index: number,
  after: string,
  at: number,
) {
  // `pending-streaming`: still being written (syncStreaming).
  span.classList.add("pending-settled", "pending-streaming");
  const before = s.shown.get(index);
  s.shown.set(index, { after, at });
  // Just completed by the partial span, or a sentence written after it
  // joined to it in place: on screen already.
  const written =
    before === undefined
      ? s.partialIndex === index
      : before.at === at && after.startsWith(before.after);
  if (written) return;
  animateElement(
    span,
    [{ opacity: before === undefined ? 0 : 0.3 }, { opacity: 1 }],
    { duration: "--dur-base", easing: "--ease-out" },
  );
}

/** The completed changes of a streaming rewrite's layout, where they
 *  stand in the document. */
function streamChanges(
  source: NonNullable<PendingPreview["streamSource"]>,
  s: StreamState,
): PendingSentence[] {
  const { ranges } = source;
  const at = (i: number) => (i > 0 ? ranges[i - 1].to : ranges[0].from);
  return s.layout.pieces.flatMap((piece) => {
    if (piece.kind === "same") return [];
    const struck = piece.end > piece.start;
    const from = struck ? ranges[piece.start].from : at(piece.start);
    const paired = pairedPrefix(
      s.sentences.slice(piece.start, piece.end),
      piece.after,
    );
    return [
      {
        from,
        to: struck ? ranges[piece.end - 1].to : from,
        before: piece.before,
        after: piece.after,
        take: null,
        parts: ranges.slice(piece.start, piece.end),
        at: struck ? ranges[piece.start + paired - 1].to : undefined,
      },
    ];
  });
}

/**
 * A rewrite still streaming in, laid out sentence by sentence
 * (sentence-stream.ts): each completed changed sentence struck in place
 * with its new text beside it, unchanged ones and those not reached yet
 * plain, and the sentence being written after the original it rewrites
 * (struck) or, a sentence of its own, where it goes. A completed change's
 * ✓ / ✕ come in faint and take clicks once it settles; the settled
 * decorations then take over the same elements.
 */
function streamDecorations(
  p: PendingPreview,
  source: NonNullable<PendingPreview["streamSource"]>,
  s: StreamState,
  hooks: SentenceHooks,
): Decoration[] {
  const { ranges } = source;
  const at = (i: number) => (i > 0 ? ranges[i - 1].to : ranges[0].from);
  const decos: Decoration[] = [];
  const focused = hooks.focused();
  s.changes = streamChanges(source, s);
  s.changes.forEach((c, index) =>
    decos.push(
      ...changeDecorations(p.callId, index, c, {
        focused: focused?.callId === p.callId && focused.index === index,
        stagger: 0,
        labels: hooks.labels(),
        decide: hooks.decide,
        stream: s,
      }),
    ),
  );
  const index = s.changes.length;
  const { partial } = s.layout;
  s.partialIndex = partial ? index : null;
  s.drawn = layoutSignature(s.layout);
  if (!partial) return decos;
  const rewrites = partial.rewrites === null ? null : ranges[partial.rewrites];
  if (rewrites)
    decos.push(sentenceStrike(p.callId, index, rewrites, "open", "", "--i: 0"));
  decos.push(
    Decoration.widget(
      rewrites ? rewrites.to : at(partial.at),
      (view) => {
        const span = document.createElement("span");
        span.className =
          "pending-insert pending-replaces pending-partial pending-streaming";
        span.contentEditable = "false";
        span.dataset.call = p.callId;
        span.dataset.index = String(index);
        const anim = animations.get(p.callId);
        if (anim) {
          anim.span = span;
          anim.view = view;
          renderAnimation(anim);
          ensureTicking(anim);
        }
        return span;
      },
      {
        // After the new text of a change ending at the same place.
        side: 3,
        part: "text",
        key: `pending-insert-${p.callId}`,
        destroy: (node) => {
          const anim = animations.get(p.callId);
          if (anim && anim.span === node) anim.span = null;
        },
      },
    ),
  );
  return decos;
}

interface SentenceHooks {
  labels: () => SentencePickLabels;
  decide: (callId: string, index: number, take: boolean | null) => void;
  /** The sentence the review bar points at, darker in the text (index
   *  -1: a proposal shown whole). */
  focused: () => { callId: string; index: number } | null;
}

/** The revision views (Word's markup views, revision-display.ts), as the
 *  editor's `data-revision-display`: the stylesheet shows each view's parts
 *  (milkdown-theme.css). */
export const REVISION_DISPLAY_ATTR = "data-revision-display";

/** The parts a view switch can show or hide. */
const REVISION_PARTS =
  ".pending-delete, .pending-insert, .pending-pick, .pending-insert-mark, .pending-delete-mark";

function shown(el: HTMLElement): boolean {
  // Hidden text stays in the document, out of the flow (font-size 0, see
  // milkdown-theme.css): display:none would start its entrance again when
  // it comes back.
  const style = getComputedStyle(el);
  return style.display !== "none" && style.fontSize !== "0px";
}

/**
 * Puts the view on the editor, and cross-fades what it brings in: the
 * parts that stay are left alone (the same elements, at full opacity), the
 * ones it shows fade in shortly from faint. Never their entrances: those
 * are for new proposals, and the parts a view switch shows are not new -
 * the plugin settles them (`pending-settled`, its own class on its own
 * widgets), and the struck originals are only ever hidden in the flow.
 * Script-driven, so reduced motion (and the e2e stylesheet) switch it off
 * through ui/motion.ts.
 */
function syncDisplay(view: EditorView, display: RevisionDisplay) {
  const root = view.dom as HTMLElement;
  const before = root.getAttribute(REVISION_DISPLAY_ATTR);
  if (before === display) return;
  const parts = [...root.querySelectorAll<HTMLElement>(REVISION_PARTS)];
  const was = before === null ? null : new Set(parts.filter(shown));
  root.setAttribute(REVISION_DISPLAY_ATTR, display);
  if (!was) return;
  for (const el of parts) {
    if (el.classList.contains("ProseMirror-widget"))
      el.classList.add("pending-settled");
    if (!was.has(el) && shown(el))
      animateElement(el, [{ opacity: 0.3 }, { opacity: 1 }], {
        duration: "--dur-base",
        easing: "--ease-out",
      });
  }
}

// Only actions that actually remove text get the strikethrough; an
// insert_before/insert_after keeps the anchor blocks verbatim, so striking
// them through would wrongly read as "this is being deleted".
function removesTextOf(p: PendingPreview): boolean {
  return (
    p.proposal.action === "replace" ||
    p.proposal.action === "replace_selection" ||
    p.proposal.action === "delete"
  );
}

/** What a proposal shown whole strikes - null for new text alone. */
function wholeStrike(p: PendingPreview): { from: number; to: number } | null {
  const from = p.strikeFrom ?? p.from;
  const to = p.strikeTo ?? p.to;
  return removesTextOf(p) && from < to ? { from, to } : null;
}

/**
 * The sentence-by-sentence layout of a rewrite streaming in, started the
 * first time it is drawn. Null where it streams in whole: no streamSource,
 * no typewriter (animation off, reduced motion), or a preview that settled
 * without ever streaming. A settled one that streamed keeps its layout
 * until its sentences arrive with the final proposal, rather than falling
 * back to one struck block for a moment.
 */
function streamFor(p: PendingPreview, animate: boolean): StreamState | null {
  if (!animate || prefersReducedMotion()) return null;
  let anim = animations.get(p.callId);
  if (!p.streaming) return anim?.stream ?? null;
  if (!anim) {
    anim = newAnimation(p.callId, p.proposal.text ?? "", false);
    animations.set(p.callId, anim);
  }
  if (!anim.stream) {
    anim.stream = {
      sentences: p.streamSource!.sentences,
      layout: { pieces: [], reached: 0, partial: null },
      reached: 0,
      alignedFor: null,
      drawn: "",
      relayoutQueued: false,
      shown: new Map(),
      partialIndex: null,
      struck: new Set(),
      changes: [],
    };
    refreshStream(anim);
  }
  return anim.stream;
}

function decorationsFor(
  p: PendingPreview,
  animate: boolean,
  hooks: SentenceHooks,
): Decoration[] {
  if (p.sentences && !p.streaming)
    return sentenceDecorations(p, p.sentences.changes, hooks);
  const stream = p.streamSource && streamFor(p, animate);
  if (stream) return streamDecorations(p, p.streamSource!, stream, hooks);
  const decos: Decoration[] = [];
  const removesText = removesTextOf(p);
  const strikeTo = p.strikeTo ?? p.to;
  const focused = hooks.focused();
  const isFocused = focused?.callId === p.callId && focused.index === -1;
  const strike = wholeStrike(p);
  if (strike) {
    decos.push(
      Decoration.inline(
        strike.from,
        strike.to,
        {
          class: `pending-delete pending-whole${isFocused ? " pending-sentence-focus" : ""}`,
          role: "deletion",
          "data-call": p.callId,
          "data-index": "-1",
        },
        { part: "struck" },
      ),
    );
  }
  const text = p.proposal.text;
  if (text !== undefined && p.proposal.action !== "delete") {
    const atStart = p.proposal.action === "insert_before";
    // `replace`'s insert point follows the strike range specifically (not
    // just "p.to") so the green text lands immediately after the red -
    // "struck old text, new text right after" - rather than at the very end
    // of a whole re-parsed block that may extend well past what was struck.
    const insertPos = atStart
      ? p.from
      : p.proposal.action === "replace"
        ? strikeTo
        : p.to;
    decos.push(
      textWidget(p, insertPos, atStart ? -1 : 1, animate, removesText),
    );
  }
  return decos;
}

function buildDecorations(
  doc: ProseNode,
  previews: PendingPreview[],
  animate: boolean,
  hooks: SentenceHooks,
): DecorationSet {
  const decos = previews.flatMap((p) => decorationsFor(p, animate, hooks));
  return DecorationSet.create(doc, [...decos, ...struckBlocks(doc, decos)]);
}

/**
 * The blocks whose text is all struck and that hold no new text: a
 * paragraph a rewrite folds into the one before it, or one it deletes.
 * The views that take the originals out of the text ("new", "final") take
 * these out of the flow too (`pending-struck-block`): their text hidden,
 * they still stood there as empty lines with a paragraph's margins, and a
 * rewrite that joins paragraphs left blank gaps in the text. One that
 * holds the mark of a deleted sentence (`pending-struck-marked`) keeps
 * its line in "new", where the mark shows. Read off the decorations' own
 * `part`: "struck" for an original those views hide, "text" for new text,
 * "mark" for a deleted sentence's mark.
 */
function struckBlocks(doc: ProseNode, decos: Decoration[]): Decoration[] {
  const part = (d: Decoration) => (d.spec as { part?: string }).part;
  const struck = decos
    .filter((d) => part(d) === "struck" && d.from < d.to)
    .map((d) => ({ from: d.from, to: d.to }))
    .sort((a, b) => a.from - b.from);
  if (struck.length === 0) return [];
  // Touching strikes (a change's sentences and the space between them)
  // cover as one.
  const covered: { from: number; to: number }[] = [];
  for (const r of struck) {
    const last = covered[covered.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else covered.push({ ...r });
  }
  const isCovered = (from: number, to: number) =>
    covered.some((r) => r.from <= from && to <= r.to);
  const texts = decos.filter((d) => part(d) === "text").map((d) => d.from);
  const marks = decos.filter((d) => part(d) === "mark").map((d) => d.from);
  const out: Decoration[] = [];
  doc.nodesBetween(
    covered[0].from,
    covered[covered.length - 1].to,
    (node, pos) => {
      if (node.isInline) return false;
      const end = pos + node.nodeSize;
      const inside = (at: number) => at > pos && at < end;
      if (texts.some(inside)) return true;
      let all = covered.some((r) => r.from < end && pos < r.to);
      node.descendants((child, at) => {
        if (all && child.isText)
          all = isCovered(pos + 1 + at, pos + 1 + at + child.nodeSize);
        return all;
      });
      if (!all) return true;
      out.push(
        Decoration.node(pos, end, {
          class: marks.some(inside)
            ? "pending-struck-block pending-struck-marked"
            : "pending-struck-block",
        }),
      );
      return false;
    },
  );
  return out;
}

/**
 * The pointer's sentence pair, a shade darker (`.pending-sentence-hot`), and
 * the text the last Accept wrote, fading from green (`.pending-landed`).
 * The text side is one more inline decoration over the sentence, which
 * ProseMirror merges into the spans already there and patches in place.
 * The widget side (the new text, a margin mark, the ✓ / ✕) gets the class
 * from the plugin view instead (`syncWidgetClasses`): a widget redrawn for it
 * would replay its entrance, the new text fading in from nothing.
 *
 * Nothing may write the class onto a decorated text span from outside:
 * ProseMirror reads that as a foreign edit and redraws the paragraph, and
 * every strike and replacement in it replays its entrance - the red and
 * the green vanished under the pointer (1.1.0-rc.4).
 */
function hotDecorations(doc: ProseNode, state: PendingState): DecorationSet {
  const { hot } = state;
  const landed = state.landed.flatMap((range) =>
    textRuns(doc, range.from, range.to).map((r) =>
      Decoration.inline(r.from, r.to, { class: "pending-landed" }),
    ),
  );
  const preview = hot
    ? state.previews.find((p) => p.callId === hot.callId)
    : undefined;
  const changes = preview && reviewChanges(preview);
  // A proposal shown whole (index -1): its struck text, if it has any.
  const range =
    !hot || !preview
      ? null
      : changes
        ? changes[hot.index]
        : hot.index < 0 && !preview.streaming
          ? wholeStrike(preview)
          : null;
  const extra =
    range && range.from < range.to
      ? [
          ...landed,
          ...textRuns(doc, range.from, range.to).map((r) =>
            Decoration.inline(r.from, r.to, { class: "pending-sentence-hot" }),
          ),
        ]
      : landed;
  return extra.length > 0 ? state.decoration.add(doc, extra) : state.decoration;
}

/** The runs of text in [from, to), without the hard breaks (and other
 *  inline leaves) between them: the darker hover tint is the text's, and a
 *  line break given it painted a box at the line's end. */
function textRuns(
  doc: ProseNode,
  from: number,
  to: number,
): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const a = Math.max(pos, from);
    const b = Math.min(pos + node.nodeSize, to);
    const last = runs[runs.length - 1];
    if (last && last.to === a) last.to = b;
    else if (a < b) runs.push({ from: a, to: b });
    return true;
  });
  return runs;
}

/** `hotDecorations` per state: `decorations` is asked on every redraw. */
const hotSets = new WeakMap<PendingState, DecorationSet>();

/**
 * The streaming side of a rewrite laid out sentence by sentence, after each
 * rebuild: the reveal is handed the view (it may have no widget to get it
 * from - nothing is drawn while a sentence repeats its original) and
 * keeps going, and the widgets of a rewrite that settled lose
 * `pending-streaming`: its ✓ / ✕ start taking clicks. A class on the
 * plugin's own widgets, not a redraw: the settle keeps every element on
 * screen as it is.
 */
function syncStreaming(view: EditorView, previews: PendingPreview[]) {
  const streaming = new Set<string>();
  for (const p of previews) {
    if (!p.streaming) continue;
    streaming.add(p.callId);
    const anim = animations.get(p.callId);
    if (!anim?.stream) continue;
    anim.view = view;
    drawStrikesIn(view, p.callId, anim.stream);
    ensureTicking(anim);
    maybeSettle(p.callId);
  }
  for (const el of view.dom.querySelectorAll<HTMLElement>(".pending-streaming"))
    if (!streaming.has(el.dataset.call ?? "")) {
      el.classList.remove("pending-streaming");
      // The faint ✓ / ✕ come up to full as they start taking clicks.
      if (el.classList.contains("pending-pick"))
        animateElement(el, [{ opacity: 0.35 }, { opacity: 1 }], {
          duration: "--dur-base",
          easing: "--ease-standard",
        });
    }
}

/**
 * The strike of an original the stream has just reached draws in: from
 * plain text to struck, as a settled proposal's strike does in CSS. Only
 * the first time that sentence is struck - ProseMirror draws a span again
 * as the sentences around it change (a dropped sentence struck beside it
 * takes its old span), and the strike must not draw in again then. A Web
 * Animation, never a class: the span is ProseMirror's.
 */
function drawStrikesIn(view: EditorView, callId: string, s: StreamState) {
  // Every colour is read before any animation starts: an animation started
  // makes the next read recalculate the page's style, once per sentence.
  const strikes: { el: HTMLElement; from: Keyframe; to: Keyframe }[] = [];
  for (const el of view.dom.querySelectorAll<HTMLElement>(
    `.pending-streamed[data-call="${CSS.escape(callId)}"]`,
  )) {
    const key = `${el.dataset.index}|${el.textContent}`;
    if (s.struck.has(key)) continue;
    s.struck.add(key);
    const end = getComputedStyle(el);
    const plain = el.parentElement
      ? getComputedStyle(el.parentElement).color
      : end.color;
    strikes.push({
      el,
      from: {
        color: plain,
        backgroundColor: "transparent",
        textDecorationColor: "transparent",
      },
      to: {
        color: end.color,
        backgroundColor: end.backgroundColor,
        textDecorationColor: end.textDecorationColor,
      },
    });
  }
  for (const { el, from, to } of strikes)
    animateElement(el, [from, to], {
      duration: "--dur-base",
      easing: "--ease-out",
    });
}

/** The widget side of `hotDecorations`, and of the review bar's pointer
 *  (`.pending-sentence-focus` on the new text): set on the widgets as they
 *  stand, not by redrawing them - a widget keyed by the pointer was
 *  redrawn on every prev / next, and its new text faded in from nothing
 *  again. Widgets are the plugin's own DOM, and ProseMirror leaves a class
 *  change on them alone. */
function syncWidgetClasses(
  view: EditorView,
  hot: HotSentence | null,
  focused: HotSentence | null,
) {
  // A rewrite streaming in can be pointed at by its completed sentences
  // (they have their cards), not by the one being written.
  const is = (el: HTMLElement, s: HotSentence | null) =>
    s !== null &&
    !el.classList.contains("pending-partial") &&
    el.dataset.call === s.callId &&
    el.dataset.index === String(s.index);
  for (const el of view.dom.querySelectorAll<HTMLElement>(
    ".ProseMirror-widget[data-call]",
  )) {
    el.classList.toggle("pending-sentence-hot", is(el, hot));
    if (!el.classList.contains("pending-pick"))
      el.classList.toggle("pending-sentence-focus", is(el, focused));
  }
}

/**
 * The previews carried through a document change: each range (strike
 * included) mapped through the transaction, and any whose mapped range no
 * longer holds the text it was resolved against dropped - an edit inside
 * or around a pending change invalidates it rather than risk applying it
 * to the wrong text later. `changed` says whether anything moved or went.
 */
function mapPreviews(
  previews: PendingPreview[],
  tr: Transaction,
): { survivors: PendingPreview[]; changed: boolean } {
  let changed = false;
  const survivors: PendingPreview[] = [];
  for (const p of previews) {
    const from = tr.mapping.map(p.from, -1);
    const to = tr.mapping.map(p.to, 1);
    if (from > to || tr.doc.textBetween(from, to, " ") !== p.expectedText) {
      changed = true;
      continue;
    }
    if (from === p.from && to === p.to) {
      survivors.push(p);
      continue;
    }
    changed = true;
    survivors.push({
      ...p,
      from,
      to,
      strikeFrom:
        p.strikeFrom === undefined
          ? undefined
          : tr.mapping.map(p.strikeFrom, -1),
      strikeTo:
        p.strikeTo === undefined ? undefined : tr.mapping.map(p.strikeTo, 1),
      sentences: p.sentences && {
        hunks: p.sentences.hunks,
        changes: p.sentences.changes.map((c) => ({
          ...c,
          from: tr.mapping.map(c.from, -1),
          to: tr.mapping.map(c.to, 1),
          parts: c.parts?.map((r) => ({
            from: tr.mapping.map(r.from, -1),
            to: tr.mapping.map(r.to, 1),
          })),
          at: c.at === undefined ? undefined : tr.mapping.map(c.at, -1),
        })),
      },
      streamSource: p.streamSource && {
        sentences: p.streamSource.sentences,
        ranges: p.streamSource.ranges.map((r) => ({
          from: tr.mapping.map(r.from, -1),
          to: tr.mapping.map(r.to, 1),
        })),
      },
    });
  }
  return { survivors, changed };
}

/** The previews with each streaming rewrite's completed changes as last
 *  drawn (PendingPreview.streamChanges): a new preview only when they
 *  changed, so React hears of each change as it completes, not of every
 *  frame of the sentence being written. */
function withStreamChanges(previews: PendingPreview[]): PendingPreview[] {
  let out: PendingPreview[] | null = null;
  previews.forEach((p, i) => {
    const changes = p.streaming
      ? animations.get(p.callId)?.stream?.changes
      : undefined;
    if (!changes || sameChanges(changes, p.streamChanges)) return;
    out ??= previews.slice();
    out[i] = { ...p, streamChanges: changes };
  });
  return out ?? previews;
}

function sameChanges(a: PendingSentence[], b: PendingSentence[] | undefined) {
  return (
    b !== undefined &&
    a.length === b.length &&
    a.every(
      (c, i) =>
        c.from === b[i].from &&
        c.to === b[i].to &&
        c.at === b[i].at &&
        c.before === b[i].before &&
        c.after === b[i].after,
    )
  );
}

/**
 * Shows agent propose_edit proposals as live decorations in the document
 * instead of only a chat-panel diff card - the pending-insert/pending-delete
 * pair is this plugin's whole job; the actual document mutation on accept
 * happens outside it (usePendingEdits.ts), the same way ghost-text-plugin's
 * widget is separate from the Tab keystroke that commits it.
 *
 * Mirrors grammar-check-plugin's staleness handling: every docChanged maps
 * each preview's range through the transaction and drops it if the mapped
 * range's text no longer matches what was resolved - an edit inside or
 * around a pending change invalidates it rather than risk applying to the
 * wrong text later.
 */
export function createPendingEditPlugin(options: {
  /** Accept/reject via ⌘Enter / ⌘Backspace. Wired to the same accept/reject
   *  usePendingEdits.ts exposes for the button path, so the two can't
   *  drift. Targets `getFocusedCallId()` when it names a still-pending
   *  preview (kept in sync with the Quick Ask nav bar's "current" pointer),
   *  falling back to the first preview otherwise - e.g. before any preview
   *  has been focused yet, or in the detached window, which has no nav bar
   *  and so never supplies this. */
  onAccept?: (callId: string) => void;
  onReject?: (callId: string) => void;
  /** Fired whenever the live preview list changes (add/remove/clear, or a
   *  docChanged that drops a stale one) - the plugin's only way to reach
   *  React, since nothing else polls ProseMirror state. Drives the
   *  in-document accept/reject controls and the chat panel's proposal
   *  status chips. */
  onPreviewsChange?: (previews: PendingPreview[], applied: string[]) => void;
  /** Whether the green widget types its text in (Settings toggle, read live
   *  per decoration build). Off, or unset: the text appears at once. */
  animationEnabled?: () => boolean;
  /** Live read of the Quick Ask nav bar's current pointer (usePendingEdits'
   *  `focusedPreview`) - see `onAccept`/`onReject` above. */
  getFocusedCallId?: () => string | null;
  /** A ✓ / ✕ in the text was clicked (usePendingEdits.decide). */
  onDecide?: (callId: string, index: number, take: boolean | null) => void;
  /** The ✓ / ✕ buttons' names, read live (the UI language can change). */
  sentenceLabels?: () => SentencePickLabels;
  /** The sentence the review bar points at (usePendingEdits). */
  getFocusedSentence?: () => { callId: string; index: number } | null;
  /** How a rewrite is drawn, already fallen back to "inline" where there
   *  is no margin - read live; any transaction (a "refocus" meta after it
   *  changes) puts it on the editor (`syncDisplay`). */
  revisionDisplay?: () => RevisionDisplay;
}) {
  const animate = () => options.animationEnabled?.() ?? false;
  const hooks: SentenceHooks = {
    labels: () =>
      options.sentenceLabels?.() ?? { take: "Accept", keep: "Keep original" },
    decide: (callId, index, take) => options.onDecide?.(callId, index, take),
    focused: () => options.getFocusedSentence?.() ?? null,
  };
  /** Whatever left the preview list takes its typewriter state with it. */
  const dropRemovedAnimations = (
    prev: PendingPreview[],
    next: PendingPreview[],
  ) => {
    for (const p of prev) {
      if (!next.some((n) => n.callId === p.callId)) dropAnimation(p.callId);
    }
  };
  const applyMeta = (
    tr: Transaction,
    prev: PendingState,
    meta: PendingMeta | undefined,
  ): Omit<PendingState, "applied" | "hot" | "landed"> => {
    if (meta?.type === "add") {
      const keep = prev.previews.filter(
        (p) => !meta.previews.some((n) => n.callId === p.callId),
      );
      // A final (non-streaming) add for a callId whose typewriter is
      // still revealing keeps the streaming state - the settle meta,
      // not the add, is what makes the preview decidable.
      const previews = [
        ...keep,
        ...meta.previews.map((p) =>
          p.streaming || stillRevealing(p.callId)
            ? { ...p, streaming: true }
            : p,
        ),
      ];
      return {
        previews,
        decoration: buildDecorations(tr.doc, previews, animate(), hooks),
      };
    }
    if (meta?.type === "settle") {
      if (!prev.previews.some((p) => p.callId === meta.callId && p.streaming))
        return prev;
      const previews = prev.previews.map((p) =>
        p.callId === meta.callId ? { ...p, streaming: undefined } : p,
      );
      return {
        previews,
        decoration: buildDecorations(tr.doc, previews, animate(), hooks),
      };
    }
    if (meta?.type === "decide") {
      const previews = prev.previews.map((p) =>
        p.callId === meta.callId && p.sentences
          ? {
              ...p,
              sentences: {
                hunks: p.sentences.hunks,
                changes: p.sentences.changes.map((c, i) =>
                  i === meta.index ? { ...c, take: meta.take } : c,
                ),
              },
            }
          : p,
      );
      return {
        previews,
        decoration: buildDecorations(tr.doc, previews, animate(), hooks),
      };
    }
    if (
      meta?.type === "refocus" ||
      (meta?.type === "relayout" &&
        prev.previews.some((p) => p.callId === meta.callId))
    ) {
      return {
        previews: prev.previews,
        decoration: buildDecorations(tr.doc, prev.previews, animate(), hooks),
      };
    }
    if (meta?.type === "remove") {
      const rest = prev.previews.filter((p) => p.callId !== meta.callId);
      // Accepting a proposal applies it and removes its preview in
      // one transaction (usePendingEdits.ts): the others still have
      // to be mapped through that edit. Left at their old positions,
      // every preview below a grown or shrunk block drifted off its
      // text, and its Accept then refused.
      const previews = tr.docChanged ? mapPreviews(rest, tr).survivors : rest;
      dropRemovedAnimations(prev.previews, previews);
      return {
        previews,
        decoration: buildDecorations(tr.doc, previews, animate(), hooks),
      };
    }
    if (meta?.type === "clear") {
      dropRemovedAnimations(prev.previews, []);
      return prev.previews.length === 0
        ? prev
        : { previews: [], decoration: DecorationSet.empty };
    }
    if (tr.docChanged && prev.previews.length > 0) {
      const { survivors, changed } = mapPreviews(prev.previews, tr);
      if (!changed) {
        // Typing below the last pending edit - the common case while
        // a preview sits mid-document. Keeping the ARRAY's identity
        // is what stops view.update's `previews !== last` check from
        // re-notifying React (and, downstream, re-emitting the
        // statuses IPC push) on every keystroke; mapping the
        // existing DecorationSet instead of rebuilding it is the
        // same pattern quick-ask-widget-plugin uses.
        return {
          previews: prev.previews,
          decoration: prev.decoration.map(tr.mapping, tr.doc),
        };
      }
      dropRemovedAnimations(prev.previews, survivors);
      return {
        previews: survivors,
        decoration: buildDecorations(tr.doc, survivors, animate(), hooks),
      };
    }
    return prev;
  };
  return $prose(
    () =>
      new Plugin<PendingState>({
        key: pendingEditKey,
        // A proposal for text folded in a <details> opens it: an edit the
        // writer can't see can't be decided on.
        foldAttention: ((state) =>
          (pendingEditKey.getState(state)?.previews ?? []).map((p) => ({
            key: `edit:${p.callId}`,
            from: p.from,
            to: p.to,
          }))) satisfies FoldAttention,
        state: {
          init: (): PendingState => ({
            previews: [],
            decoration: DecorationSet.empty,
            applied: [],
            hot: null,
            landed: [],
          }),
          apply(tr, prev): PendingState {
            const meta = tr.getMeta(pendingEditKey) as PendingMeta | undefined;
            const replay = tr.docChanged ? replayHistory(tr, prev) : null;
            if (replay) {
              dropRemovedAnimations(prev.previews, replay.previews);
              return {
                previews: replay.previews,
                applied: replay.applied,
                hot: prev.hot,
                landed: [],
                decoration: buildDecorations(
                  tr.doc,
                  replay.previews,
                  false,
                  hooks,
                ),
              };
            }
            let applied = prev.applied;
            if (meta?.type === "remove" && meta.applied && tr.docChanged) {
              const taken = prev.previews.find((p) => p.callId === meta.callId);
              if (taken)
                applied = [
                  ...applied.filter((e) => e.preview.callId !== meta.callId),
                  {
                    preview: taken,
                    before: tr.before,
                    after: tr.doc,
                    undone: false,
                  },
                ].slice(-MAX_APPLIED);
            } else if (meta?.type === "clear") {
              applied = [];
            }
            const hot = meta?.type === "hot" ? meta.sentence : prev.hot;
            const landed =
              meta?.type === "remove" && meta.landed
                ? meta.landed
                : tr.docChanged && prev.landed.length > 0
                  ? []
                  : prev.landed;
            const next = applyMeta(tr, prev, meta);
            const previews = withStreamChanges(next.previews);
            return next === prev &&
              previews === prev.previews &&
              applied === prev.applied &&
              hot === prev.hot &&
              landed === prev.landed
              ? prev
              : { ...next, previews, applied, hot, landed };
          },
        },
        props: {
          decorations(state) {
            const pending = pendingEditKey.getState(state);
            if (!pending?.hot && !pending?.landed.length)
              return pending?.decoration;
            let set = hotSets.get(pending);
            if (!set) {
              set = hotDecorations(state.doc, pending);
              hotSets.set(pending, set);
            }
            return set;
          },
          handleKeyDown(view, event) {
            const mod = event.metaKey || event.ctrlKey;
            if (!mod) return false;
            const previews =
              pendingEditKey.getState(view.state)?.previews ?? [];
            if (previews.length === 0) return false;
            const focused = options.getFocusedCallId?.() ?? null;
            const targetId =
              (focused && previews.some((p) => p.callId === focused)
                ? focused
                : null) ?? previews[0].callId;
            if (event.key === "Enter") {
              event.preventDefault();
              options.onAccept?.(targetId);
              return true;
            }
            if (event.key === "Backspace") {
              // Ctrl+Backspace (Windows/Linux) and Cmd+Backspace (macOS)
              // are everyday "delete word/line" keys, so they only mean
              // Reject with the caret on a preview itself - anywhere else
              // they used to throw a suggestion away mid-sentence.
              const { selection } = view.state;
              if (!selection.empty) return false;
              const here = previews.find(
                (p) => selection.from >= p.from && selection.from <= p.to,
              );
              if (!here) return false;
              event.preventDefault();
              options.onReject?.(here.callId);
              return true;
            }
            return false;
          },
        },
        view(editorView) {
          let last: PendingPreview[] = [];
          let lastApplied: AppliedEdit[] = [];
          let lastDecoration: DecorationSet | null = null;
          let lastHot: HotSentence | null = null;
          const display = () => options.revisionDisplay?.() ?? "inline";
          syncDisplay(editorView, display());
          return {
            update(view) {
              syncDisplay(view, display());
              const state = pendingEditKey.getState(view.state);
              const previews = state?.previews ?? [];
              // Also when only the previews changed: a rewrite streaming in
              // may have nothing drawn yet (an empty set is always the
              // same one).
              if (
                state &&
                (state.decoration !== lastDecoration || previews !== last)
              )
                syncStreaming(view, previews);
              // After any rebuild ("refocus" included), not only when the
              // pointer moves: a redrawn widget comes back without the
              // classes.
              if (
                state &&
                (state.hot !== lastHot || state.decoration !== lastDecoration)
              ) {
                lastHot = state.hot;
                lastDecoration = state.decoration;
                syncWidgetClasses(view, state.hot, hooks.focused());
              }
              const applied = state?.applied ?? [];
              if (previews !== last || applied !== lastApplied) {
                last = previews;
                lastApplied = applied;
                options.onPreviewsChange?.(
                  previews,
                  appliedCallIds(view.state),
                );
              }
            },
          };
        },
      }),
  );
}
