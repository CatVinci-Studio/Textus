import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Decoration } from "@milkdown/kit/prose/view";
import { pairedPrefix } from "./sentence-diff";
import { type StreamLayout } from "./sentence-stream";
import { type PendingPreview, type PendingSentence } from "./pending-types";
import { wholeParagraphs } from "./whole-paragraphs";
import {
  type StreamState,
  animations,
  ensureTicking,
  layoutSignature,
  renderAnimation,
} from "./pending-animation";
import { type SentenceHooks } from "./pending-decorations";
import { changeDecorations, sentenceStrike } from "./pending-widgets";

/**
 * A rewrite while it streams in: its completed changes drawn where they
 * stand, the sentence being written, and the reading tint on the paragraph
 * it is at. The pieces they are drawn with are pending-widgets.ts's.
 */

/** The completed changes of a streaming rewrite's layout, where they
 *  stand in the document - drawn as the finished rewrite draws them: a
 *  change of several whole paragraphs (short lines taken together) as the
 *  blocks it will be. In their run of text, a blank line stood between
 *  them while they streamed. */
export function streamChanges(
  doc: ProseNode,
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
    const blocks = struck
      ? wholeParagraphs(doc, { from, to }, piece.before, piece.after)
      : null;
    if (blocks) return [{ ...base, ...blocks }];
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
  s.changes = streamChanges(doc, source, s);
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
  // Past every original a landed change has taken: one struck (and, in
  // Result only, hidden) can't show the tint.
  const at = layout.pieces.reduce(
    (next, piece) =>
      piece.kind === "change" ? Math.max(next, piece.end) : next,
    layout.reached,
  );
  const range = ranges[at];
  if (!range || range.from >= range.to) return null;
  return Decoration.inline(
    range.from,
    paragraphEnd(doc, ranges, at),
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
