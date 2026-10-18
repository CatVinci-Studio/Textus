import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { isHistoryTransaction } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { renderMarkdownInlineHtml } from "../../editor/markdown/render-html";
import { StreamReveal } from "../stream-reveal";
import type { FoldAttention } from "../../editor/html/raw-html-preview-plugin";
import type { EditProposal } from "../types";
import type { SentenceHunk } from "./sentence-diff";
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
   *  typewriter shows the new text whole. Absent: shown and decided whole. */
  sentences?: { hunks: SentenceHunk[]; changes: PendingSentence[] };
}

/** Accept's text for a sentence-by-sentence preview: the original with the
 *  changes the writer didn't turn down (undecided ones are taken). */
export function sentenceTake(p: PendingPreview): boolean[] | null {
  return p.sentences ? p.sentences.changes.map((c) => c.take !== false) : null;
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
  };
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

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
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
  anim.span.innerHTML = renderMarkdownInlineHtml(anim.reveal.text);
  anim.span.classList.toggle(
    "pending-insert-typing",
    !anim.reveal.caughtUp || !anim.done,
  );
}

/** Types the text out a frame at a time until it has caught up with what
 *  has arrived; the next fragment starts it again. */
function ensureTicking(anim: InsertAnimation) {
  if (anim.frame !== null || anim.span === null) return;
  if (anim.reveal.caughtUp) {
    renderAnimation(anim);
    return;
  }
  const step = (now: number) => {
    anim.reveal.tick(now);
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

type PendingMeta =
  | { type: "add"; previews: PendingPreview[] }
  /** `applied`: Accept put the proposal into the document in the same
   *  transaction - kept so an undo can bring the proposal back. */
  | { type: "remove"; callId: string; applied?: boolean }
  | { type: "clear" }
  /** The typewriter finished revealing this preview's text - it may now be
   *  decided on (dispatched by maybeSettle, never from outside). */
  | { type: "settle"; callId: string }
  /** The writer took (true) or kept the original of (false) one sentence,
   *  or took the call back (null) - the in-text ✓ / ✕ and the card's. */
  | { type: "decide"; callId: string; index: number; take: boolean | null }
  /** The review bar's pointer moved: redraw the outline. */
  | { type: "refocus" };

interface PendingState {
  previews: PendingPreview[];
  decoration: DecorationSet;
  /** Accepted proposals, with the document before and after the accept:
   *  an undo back to `before` puts the proposal on offer again (its card
   *  had kept saying "Applied" over the restored text), a redo back to
   *  `after` takes it away again. */
  applied: AppliedEdit[];
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
) {
  return Decoration.widget(
    pos,
    (view) => {
      const span = document.createElement("span");
      span.className = "pending-insert";
      span.contentEditable = "false";
      const text = p.proposal.text ?? "";
      if (!animate || prefersReducedMotion()) {
        span.innerHTML = renderMarkdownInlineHtml(text);
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
 * The widgets' keys carry the decision, so a decision redraws them and
 * their CSS entrance runs as the change of state; `--i` staggers the
 * first appearance sentence by sentence.
 */
function sentenceDecorations(
  p: PendingPreview,
  changes: PendingSentence[],
  hooks: SentenceHooks,
): Decoration[] {
  const decos: Decoration[] = [];
  const labels = hooks.labels();
  const focused = hooks.focused();
  changes.forEach((c, index) => {
    const state =
      c.take === false ? "kept" : c.take === true ? "taken" : "open";
    const isFocused = focused?.callId === p.callId && focused.index === index;
    const stagger = `--i: ${index}`;
    if (c.from < c.to)
      decos.push(
        Decoration.inline(c.from, c.to, {
          class: `pending-delete pending-sentence pending-sentence-${state}${isFocused ? " pending-sentence-focus" : ""}`,
          style: stagger,
          "data-call": p.callId,
          "data-index": String(index),
        }),
      );
    const display = hooks.display();
    const mark = (cls: string) =>
      Decoration.widget(
        c.to,
        () => {
          const el = document.createElement("span");
          el.className = cls;
          el.dataset.call = p.callId;
          el.dataset.index = String(index);
          return el;
        },
        {
          side: 1,
          key: `pending-mark-${p.callId}-${index}-${state}-${display}`,
        },
      );
    // The original in the text, the replacement and its ✓ / ✕ a card in
    // the margin (ReviewMargin.tsx); a pure insertion marked by a caret.
    if (display === "original") {
      if (c.from === c.to)
        decos.push(mark(`pending-insert-mark pending-sentence-${state}`));
      return;
    }
    // The replacement in the text, as it would read - the original in the
    // margin ("new"), or nowhere ("final": only the result, its decision
    // left to the review bar and the AI card). A kept sentence is simply
    // the original again.
    if (display === "new" || display === "final") {
      if (state === "kept") {
        if (c.from < c.to && display === "new")
          decos.push(
            Decoration.inline(c.from, c.to, {
              class: "pending-sentence-kept-original",
              "data-call": p.callId,
              "data-index": String(index),
            }),
          );
        else if (display === "new")
          decos.push(mark("pending-insert-mark pending-sentence-kept"));
        return;
      }
      if (c.from < c.to)
        decos.push(
          Decoration.inline(c.from, c.to, { class: "pending-sentence-hidden" }),
        );
      if (c.after.trim())
        decos.push(
          Decoration.widget(
            c.to,
            () => {
              const span = document.createElement("span");
              span.className = `pending-insert pending-sentence-new pending-sentence-${state}${display === "final" ? " pending-sentence-final" : ""}${isFocused ? " pending-sentence-focus" : ""}`;
              span.contentEditable = "false";
              span.dataset.call = p.callId;
              span.dataset.index = String(index);
              span.setAttribute("style", stagger);
              span.innerHTML = renderMarkdownInlineHtml(c.after.trim());
              return span;
            },
            {
              side: 1,
              key: `pending-new-${p.callId}-${index}-${state}-${isFocused}-${display}`,
            },
          ),
        );
      else if (display === "new")
        decos.push(mark(`pending-delete-mark pending-sentence-${state}`));
      return;
    }
    if (c.after.trim())
      decos.push(
        Decoration.widget(
          c.to,
          () => {
            const span = document.createElement("span");
            span.className = `pending-insert pending-sentence-new pending-sentence-${state}${isFocused ? " pending-sentence-focus" : ""}`;
            span.contentEditable = "false";
            span.setAttribute("style", stagger);
            span.innerHTML = renderMarkdownInlineHtml(c.after.trim());
            return span;
          },
          {
            side: 1,
            key: `pending-new-${p.callId}-${index}-${state}-${isFocused}`,
          },
        ),
      );
    decos.push(
      Decoration.widget(
        c.to,
        () => {
          const pick = document.createElement("span");
          pick.className = `pending-pick pending-pick-${state}`;
          pick.contentEditable = "false";
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
              hooks.decide(p.callId, index, c.take === take ? null : take);
            });
            return b;
          };
          pick.append(button(true), button(false));
          return pick;
        },
        {
          side: 2,
          key: `pending-pick-${p.callId}-${index}-${state}`,
          ignoreSelection: true,
          stopEvent: () => true,
        },
      ),
    );
  });
  return decos;
}

interface SentenceHooks {
  /** How a rewrite is drawn (revision-display.ts): Word's markup views. */
  display: () => RevisionDisplay;
  labels: () => SentencePickLabels;
  decide: (callId: string, index: number, take: boolean | null) => void;
  /** The sentence the review bar points at, outlined in the text. */
  focused: () => { callId: string; index: number } | null;
}

function decorationsFor(
  p: PendingPreview,
  animate: boolean,
  hooks: SentenceHooks,
): Decoration[] {
  if (p.sentences && !p.streaming)
    return sentenceDecorations(p, p.sentences.changes, hooks);
  const decos: Decoration[] = [];
  // Only actions that actually remove text get the strikethrough; an
  // insert_before/insert_after keeps the anchor blocks verbatim, so striking
  // them through would wrongly read as "this is being deleted".
  const removesText =
    p.proposal.action === "replace" ||
    p.proposal.action === "replace_selection" ||
    p.proposal.action === "delete";
  const strikeFrom = p.strikeFrom ?? p.from;
  const strikeTo = p.strikeTo ?? p.to;
  if (strikeFrom < strikeTo && removesText) {
    decos.push(
      Decoration.inline(strikeFrom, strikeTo, { class: "pending-delete" }),
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
    decos.push(textWidget(p, insertPos, atStart ? -1 : 1, animate));
  }
  return decos;
}

function buildDecorations(
  doc: ProseNode,
  previews: PendingPreview[],
  animate: boolean,
  hooks: SentenceHooks,
): DecorationSet {
  return DecorationSet.create(
    doc,
    previews.flatMap((p) => decorationsFor(p, animate, hooks)),
  );
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
        })),
      },
    });
  }
  return { survivors, changed };
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
   *  is no margin - read live; a "refocus" meta redraws after it changes. */
  revisionDisplay?: () => RevisionDisplay;
}) {
  const animate = () => options.animationEnabled?.() ?? false;
  const hooks: SentenceHooks = {
    display: () => options.revisionDisplay?.() ?? "inline",
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
  ): Omit<PendingState, "applied"> => {
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
    if (meta?.type === "refocus") {
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
        // same pattern chat-selection-plugin and
        // quick-ask-widget-plugin use.
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
          }),
          apply(tr, prev): PendingState {
            const meta = tr.getMeta(pendingEditKey) as PendingMeta | undefined;
            const replay = tr.docChanged ? replayHistory(tr, prev) : null;
            if (replay) {
              dropRemovedAnimations(prev.previews, replay.previews);
              return {
                previews: replay.previews,
                applied: replay.applied,
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
            const next = applyMeta(tr, prev, meta);
            return next === prev && applied === prev.applied
              ? prev
              : { ...next, applied };
          },
        },
        props: {
          decorations(state) {
            return pendingEditKey.getState(state)?.decoration;
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
        view() {
          let last: PendingPreview[] = [];
          let lastApplied: AppliedEdit[] = [];
          return {
            update(view) {
              const state = pendingEditKey.getState(view.state);
              const previews = state?.previews ?? [];
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
