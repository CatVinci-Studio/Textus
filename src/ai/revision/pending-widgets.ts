import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Decoration } from "@milkdown/kit/prose/view";
import { prefersReducedMotion } from "../../ui/motion";
import { enterOnBeat, glideAfter, startBeat } from "../../ui/moves";
import { inlineSentence, pairedPrefix } from "./sentence-diff";
import { type StreamLayout } from "./sentence-stream";
import { type PendingPreview, type PendingSentence } from "./pending-types";
import {
  type StreamState,
  animations,
  ensureTicking,
  layoutSignature,
  maybeSettle,
  newAnimation,
  renderAnimation,
  renderPendingHtml,
  stopFrame,
  textKey,
  updateAnimation,
  hasBlocks,
} from "./pending-animation";
import { type SentenceHooks } from "./pending-decorations";

/**
 * The pieces a proposal is drawn with: the green text widget, a sentence's
 * strike and its ✓ / ✕, a change drawn whole, and a rewrite streaming in
 * sentence by sentence with its reading cursor.
 */

export function textWidget(
  p: PendingPreview,
  pos: number,
  side: -1 | 1 | 2,
  animate: boolean,
  replaces: boolean,
) {
  return Decoration.widget(
    pos,
    (view) => {
      // Between two blocks (an append, text after a paragraph), the new
      // text is blocks of its own (fillPendingBlocks); inside a paragraph,
      // the run of text it goes into - unless it is blocks itself (Write
      // at the caret, after a paragraph's last word): drawn as a run of
      // text, its headings showed their `##` and its lists their `-`.
      const blocks =
        view.state.doc.resolve(pos).parent.type ===
          view.state.schema.topNodeType || hasBlocks(p.proposal.text ?? "");
      const span = document.createElement(blocks ? "div" : "span");
      if (blocks) span.dataset.blocks = "true";
      // `pending-replaces`: there is an original, which the margin views
      // can show instead. New text alone (Write) has none, and stays in
      // the text, green, in every view but "final".
      span.className = `pending-insert pending-whole${replaces ? " pending-replaces" : ""}${blocks ? " pending-blocks" : ""}`;
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
      key: `pending-insert-${p.callId}-${p.revision ?? 0}`,
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
export const CHECK_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
export const CROSS_SVG =
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
export function sentenceDecorations(
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
export interface ChangeDraw {
  focused: boolean;
  stagger: number;
  labels: SentencePickLabels;
  /** Only reached once settled: a streaming rewrite's ✓ / ✕ take no
   *  clicks, and it has no sentences to decide yet anyway. */
  decide: SentenceHooks["decide"];
  stream?: StreamState;
  /** The document, while it streams: where a change's new text goes is
   *  checked against it (`outOfHeading`). */
  doc?: ProseNode;
}

/**
 * Where a streaming change's new text goes, when that is inside a heading
 * it isn't one of - a story's first paragraph written where its title
 * stood: after the heading, as a block. It was drawn in the title's type
 * until the rewrite settled, then dropped to its own (the standard flow's
 * translation, 1.2.1); settled, a change is laid out so already.
 */
function outOfHeading(
  doc: ProseNode | undefined,
  at: number,
  after: string,
): number | null {
  if (!doc) return null;
  const $at = doc.resolve(Math.min(at, doc.content.size));
  if ($at.parent.type.name !== "heading") return null;
  return /^#{1,6}\s/.test(after.trimStart()) ? null : $at.after();
}

export function changeDecorations(
  callId: string,
  index: number,
  c: Pick<
    PendingSentence,
    "from" | "to" | "after" | "take" | "parts" | "at" | "block"
  >,
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
  // A whole block's original is struck as the blocks it is: a picture or a
  // table has no words to draw a line through.
  if (c.block) {
    // An added block has no original to strike.
    // Several paragraphs changed as one are struck each as its node.
    if (c.from < c.to)
      for (const node of c.parts ?? [c])
        decos.push(blockStrike(callId, index, node, state, focus));
  } else if (c.from < c.to)
    for (const part of strikeParts(c))
      decos.push(sentenceStrike(callId, index, part, state, focus, stagger));
  // The new text and its ✓ / ✕: after the sentences it replaces.
  const below = outOfHeading(draw.doc, c.at ?? c.to, c.after);
  const block = c.block || below !== null;
  const at = below ?? c.at ?? c.to;
  // While the rewrite streams in, everything a change will have once it
  // settles is drawn already, so the settle moves nothing: the ✓ / ✕ faint
  // and inert (`pending-streaming`, which syncStreaming takes off).
  const streaming = draw.stream ? " pending-streaming" : "";
  // Where a pure insertion goes, for the view that leaves its new text to
  // the margin ("original").
  if (c.from === c.to)
    decos.push(
      Decoration.widget(
        c.to,
        () => {
          const el = document.createElement("span");
          el.className = `pending-insert-mark pending-sentence-${state}${streaming}`;
          el.dataset.call = callId;
          el.dataset.index = String(index);
          return el;
        },
        { side: 1, key: `pending-mark-insert-${callId}-${index}-${state}` },
      ),
    );
  // The line break a sentence ends with stays the original's, in the text.
  // A whole block (a table, a picture) is drawn as one, between blocks.
  const after = block ? c.after.trim() : inlineSentence(c.after);
  if (after) {
    const key = `pending-new-${callId}-${index}-${state}-${textKey(after)}`;
    decos.push(
      Decoration.widget(
        at,
        () => {
          const span = document.createElement(block ? "div" : "span");
          if (block) span.dataset.blocks = "true";
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
  // Where a deleted sentence was, for Result only - its card in the
  // margin holds it.
  else
    decos.push(
      Decoration.widget(
        c.to,
        () => {
          const el = document.createElement("span");
          el.className = `pending-delete-mark pending-sentence-${state}${streaming}`;
          el.dataset.call = callId;
          el.dataset.index = String(index);
          return el;
        },
        {
          side: 1,
          key: `pending-mark-delete-${callId}-${index}-${state}`,
          part: "mark",
        },
      ),
    );
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
export function strikeParts(
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
export function sentenceStrike(
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

/** A block of a whole-block change's original, struck as one (the
 *  struck blocks of a join, `pending-whole`). */
function blockStrike(
  callId: string,
  index: number,
  range: { from: number; to: number },
  state: string,
  focus: string,
): Decoration {
  return Decoration.node(range.from, range.to, {
    class: `pending-delete pending-whole pending-sentence-${state}${focus}`,
    ...(state === "kept" ? {} : { role: "deletion" }),
    "data-call": callId,
    "data-index": String(index),
  });
}

/** The beat a change enters on: its new text in the text and its card in
 *  the margin (the card's key, useReviewNotes) share it. */
export function changeBeat(callId: string, index: number): string {
  return `rev:${callId}:${index}`;
}

/**
 * How a completed change's new text comes in while the rewrite streams: a
 * paragraph rewritten whole lands at once, all its changes on one beat
 * with their cards (`landedAt`) - fading in where they stand, a whole block
 * rising into place, as new writing does. The sentence the partial span
 * was just writing (a long one cut at a pause) is already on screen as it
 * is: no entrance. One a re-alignment changed or moved - a sentence the
 * rewrite dropped joins the change before it - comes in again.
 */
export function streamEntrance(
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
  const beat = changeBeat(span.dataset.call ?? "", index);
  startBeat(beat, s.landedAt);
  // Inline, a sentence only fades: an inline box takes no transform.
  const block = span.dataset.blocks === "true";
  enterOnBeat(span, beat, {
    from: block ? "up" : "none",
    distance: "md",
    duration: "--dur-slow",
  });
  // A whole block pushes the text below it down: that glides there. Once
  // it is in the document (a widget is drawn after it is made), before the
  // frame is painted.
  if (span.dataset.blocks !== "true") return;
  queueMicrotask(() => {
    const root = span.closest(".ProseMirror");
    if (root) glideAfter(span, span.offsetHeight, root);
  });
}

/** The completed changes of a streaming rewrite's layout, where they
 *  stand in the document. */
export function streamChanges(
  source: NonNullable<PendingPreview["streamSource"]>,
  s: StreamState,
): PendingSentence[] {
  const { ranges } = source;
  const at = (i: number) => (i > 0 ? ranges[i - 1].to : ranges[0].from);
  return s.layout.pieces.flatMap((piece): PendingSentence[] => {
    if (piece.kind === "same") return [];
    const struck = piece.end > piece.start;
    const from = struck ? ranges[piece.start].from : at(piece.start);
    const to = struck ? ranges[piece.end - 1].to : from;
    const base: PendingSentence = {
      from,
      to,
      before: piece.before,
      after: piece.after,
      take: null,
    };
    // A block changed whole, drawn as the finished rewrite draws it.
    if (struck && piece.end - piece.start === 1 && ranges[piece.start].block)
      return [{ ...base, block: true, at: to }];
    const paired = pairedPrefix(
      s.sentences.slice(piece.start, piece.end),
      piece.after,
    );
    return [
      {
        ...base,
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
export function streamDecorations(
  doc: ProseNode,
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
        doc,
      }),
    ),
  );
  const index = s.changes.length;
  const { partial } = s.layout;
  s.partialIndex = partial ? index : null;
  s.drawn = layoutSignature(s.layout);
  const reading = readingDecoration(doc, p.callId, ranges, s.layout);
  if (reading) decos.push(reading);
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
        key: `pending-insert-${p.callId}-${p.revision ?? 0}`,
        destroy: (node) => {
          const anim = animations.get(p.callId);
          if (anim && anim.span === node) anim.span = null;
        },
      },
    ),
  );
  return decos;
}

/**
 * The progress cursor: the paragraph a streaming rewrite is at - the
 * originals it has reached to the end of their paragraph, which is what
 * lands next, all at once. Nothing else of it shows until then, so it is
 * tinted (and its card in the margin says it is being written), the tint
 * moving on as each paragraph lands - a light polish kept the screen still
 * for seconds, then a sentence popped up (rc.6). Past the last original
 * there is nothing to mark.
 */
export function readingDecoration(
  doc: ProseNode,
  callId: string,
  ranges: { from: number; to: number }[],
  layout: StreamLayout,
): Decoration | null {
  if (layout.partial) return null;
  const range = ranges[layout.reached];
  if (!range || range.from >= range.to) return null;
  return Decoration.inline(
    range.from,
    paragraphEnd(doc, ranges, layout.reached),
    { class: "pending-reading", "data-call": callId },
    { part: "reading" },
  );
}

/** Where the paragraph of `ranges[at]` ends among the originals: the end
 *  of the last one in the same block. */
function paragraphEnd(
  doc: ProseNode,
  ranges: { from: number; to: number }[],
  at: number,
): number {
  const start = ranges[at];
  const $from = doc.resolve(Math.min(start.from + 1, doc.content.size));
  const end = $from.parent.isTextblock ? $from.end() : start.to;
  let to = start.to;
  for (let i = at + 1; i < ranges.length && ranges[i].to <= end; i++)
    to = ranges[i].to;
  return to;
}
