import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Decoration } from "@milkdown/kit/prose/view";
import { prefersReducedMotion } from "../../ui/motion";
import { enterOnBeat, glideAfter, startBeat } from "../../ui/moves";
import { inlineSentence } from "./sentence-diff";
import { type PendingPreview, type PendingSentence } from "./pending-types";
import {
  type StreamState,
  animations,
  ensureTicking,
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

/** The pieces a proposal is drawn with: the green text widget, a sentence's
 *  strike and its ✓ / ✕, and a change drawn whole. */

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
      // Between blocks, or when it is blocks itself, the new text is drawn
      // as blocks; as inline text, headings would show their `##`.
      const blocks =
        view.state.doc.resolve(pos).parent.type ===
          view.state.schema.topNodeType || hasBlocks(p.proposal.text ?? "");
      const span = document.createElement(blocks ? "div" : "span");
      if (blocks) span.dataset.blocks = "true";
      // `pending-replaces`: there is an original the margin views can show
      // instead; new text alone leaves a mark where it goes.
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
      // The key keeps the DOM node across rebuilds, so typing elsewhere
      // doesn't restart the typewriter.
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

export const CHECK_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
export const CROSS_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

export interface SentencePickLabels {
  take: string;
  keep: string;
}

/** A sentence-by-sentence preview: each change struck with its replacement
 *  and ✓ / ✕. Every view's parts are drawn and CSS picks, so switching views
 *  redraws nothing; keys carry the decision, so deciding replays the entrance. */
export function sentenceDecorations(
  p: PendingPreview,
  changes: PendingSentence[],
  hooks: SentenceHooks,
): Decoration[] {
  const labels = hooks.labels();
  const focused = hooks.focused();
  // Streamed in: its parts are on screen already, so no stagger; only its
  // ✓ / ✕ change, starting to take clicks.
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

/** Where a streaming change's new text goes when it lands inside a heading
 *  it isn't part of: after the heading, as a block, as it will settle. */
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
  // Struck sentence by sentence, so one joined later doesn't redraw the
  // others' strikes. A whole block is struck as its blocks.
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
  // While streaming, everything is drawn already, the ✓ / ✕ faint and inert,
  // so the settle moves nothing.
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
  // Streamed in: its strike draws in from the plugin view, not CSS, since
  // ProseMirror may redraw the span and replay a CSS entrance.
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

/** A block of a whole-block change's original, struck as one. */
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

/** The beat a change enters on, shared by its new text and its card. */
export function changeBeat(callId: string, index: number): string {
  return `rev:${callId}:${index}`;
}

/** How a completed change's new text comes in while streaming: a paragraph's
 *  changes on one beat with their cards. One already on screen from the
 *  partial span gets no entrance; one realigned comes in again. */
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
  // A whole block pushes the text below down, which glides there once the
  // widget is in the document, before the frame is painted.
  if (span.dataset.blocks !== "true") return;
  queueMicrotask(() => {
    const root = span.closest(".ProseMirror");
    if (root) glideAfter(span, span.offsetHeight, root);
  });
}
