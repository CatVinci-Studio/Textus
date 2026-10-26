import type { EditorView } from "@milkdown/kit/prose/view";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  animate as animateElement,
  prefersReducedMotion,
} from "../../ui/motion";
import { pictureState } from "./generated-images";
import type { RevisionDisplay } from "../../settings/SettingsContext";
import {
  type HotSentence,
  type PendingPreview,
  type PendingState,
  reviewChanges,
} from "./pending-types";
import {
  type StreamState,
  animations,
  ensureTicking,
  maybeSettle,
  newAnimation,
  refreshStream,
} from "./pending-animation";
import {
  type SentencePickLabels,
  sentenceDecorations,
  textWidget,
} from "./pending-widgets";
import { streamDecorations } from "./stream-widgets";

/** Every proposal's decorations, built from the plugin state for the
 *  revision view the writer chose. */

export interface SentenceHooks {
  labels: () => SentencePickLabels;
  decide: (callId: string, index: number, take: boolean | null) => void;
  /** The sentence the review bar points at, darker in the text (index
   *  -1: a proposal shown whole). */
  focused: () => { callId: string; index: number } | null;
}

/** The revision view as an attribute on the editor; the stylesheet shows
 *  each view's parts. */
export const REVISION_DISPLAY_ATTR = "data-revision-display";

/** The parts a view switch can show or hide. */
export const REVISION_PARTS =
  ".pending-delete, .pending-insert, .pending-pick, .pending-insert-mark, .pending-delete-mark";

export function shown(el: HTMLElement): boolean {
  // Hidden text stays in the document, out of the flow: display:none would
  // restart its entrance when it comes back.
  const style = getComputedStyle(el);
  return style.display !== "none" && style.fontSize !== "0px";
}

/** Puts the view on the editor, fading in the parts it shows; never their
 *  entrances, which are for new proposals. */
export function syncDisplay(view: EditorView, display: RevisionDisplay) {
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
export function removesTextOf(p: PendingPreview): boolean {
  return (
    p.proposal.action === "replace" ||
    p.proposal.action === "replace_selection" ||
    p.proposal.action === "delete"
  );
}

/** What a proposal shown whole strikes - null for new text alone. */
export function wholeStrike(
  p: PendingPreview,
): { from: number; to: number } | null {
  const from = p.strikeFrom ?? p.from;
  const to = p.strikeTo ?? p.to;
  return removesTextOf(p) && from < to ? { from, to } : null;
}

/** A streaming rewrite's sentence layout, started when first drawn; null
 *  where it streams in whole. A settled one keeps it until its sentences come. */
export function streamFor(
  p: PendingPreview,
  animate: boolean,
): StreamState | null {
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
      landedAt: 0,
    };
    refreshStream(anim);
  }
  return anim.stream;
}

export function decorationsFor(
  doc: ProseNode,
  p: PendingPreview,
  animate: boolean,
  hooks: SentenceHooks,
): Decoration[] {
  if (p.sentences && !p.streaming)
    return sentenceDecorations(p, p.sentences.changes, hooks);
  const stream = p.streamSource && streamFor(p, animate);
  if (stream) return streamDecorations(doc, p, p.streamSource!, stream, hooks);
  // A picture being redone: the old one stays as it is, veiled, until the
  // new one has come - only then the two, the old struck, to decide on.
  const redraw = redrawing(p);
  if (redraw)
    return [
      Decoration.inline(
        redraw.from,
        redraw.to,
        { class: "pending-redraw", "data-call": p.callId, "aria-busy": "true" },
        { part: "redraw" },
      ),
    ];
  const decos: Decoration[] = [];
  const removesText = removesTextOf(p);
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
    decos.push(
      textWidget(p, insertAt(p), atStart ? -1 : 1, animate, removesText),
    );
  }
  return decos;
}

/** Where a proposal shown whole draws its new text: right after the strike,
 *  or by the words an insertion names, as Accept writes it. One next to a
 *  whole block goes between blocks, decided by the anchor. */
export function insertAt(p: PendingPreview): number {
  const { action } = p.proposal;
  if (action === "insert_before") return p.strikeFrom ?? p.from;
  if (action === "insert_after") return p.strikeTo ?? p.to;
  if (action === "replace") return p.strikeTo ?? p.to;
  return p.to;
}

/** The old picture's node, while the picture that redoes it is still being
 *  made. */
export function redrawing(
  p: PendingPreview,
): { from: number; to: number } | null {
  const { image, action } = p.proposal;
  if (!image || action !== "replace" || pictureState(image.id) !== "painting")
    return null;
  const strike = wholeStrike(p);
  return strike && strike.from < strike.to ? strike : null;
}

export function buildDecorations(
  doc: ProseNode,
  previews: PendingPreview[],
  animate: boolean,
  hooks: SentenceHooks,
): DecorationSet {
  const decos = previews.flatMap((p) => decorationsFor(doc, p, animate, hooks));
  return DecorationSet.create(doc, [...decos, ...struckBlocks(doc, decos)]);
}

/** Blocks wholly struck and holding no new text, which the "final" view
 *  takes out of the flow so they leave no blank gaps. Read off each
 *  decoration's `part`. */
export function struckBlocks(
  doc: ProseNode,
  decos: Decoration[],
): Decoration[] {
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

/** The pointer's sentence pair darker, and the last Accept's text fading
 *  from green. Never write a class onto a decorated span from outside:
 *  ProseMirror redraws the paragraph and every entrance replays. */
export function hotDecorations(
  doc: ProseNode,
  state: PendingState,
): DecorationSet {
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

/** The runs of text in [from, to) without inline leaves between them: a
 *  tinted line break paints a box at the line's end. */
export function textRuns(
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
export const hotSets = new WeakMap<PendingState, DecorationSet>();

/** After each rebuild, hands streaming reveals the view and takes
 *  `pending-streaming` off a settled rewrite's widgets, without a redraw. */
export function syncStreaming(view: EditorView, previews: PendingPreview[]) {
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
      // The faint ✓ / ✕ come up to full as their one move, or the delayed
      // CSS entrance would take over and dip them back to faint.
      if (el.classList.contains("pending-pick")) {
        el.style.animation = "none";
        animateElement(el, [{ opacity: 0.35 }, { opacity: 1 }], {
          duration: "--dur-base",
          easing: "--ease-standard",
        });
      }
    }
}

/** Draws in the strike of an original the stream just reached, only the
 *  first time, as ProseMirror redraws spans. A Web Animation, as the span
 *  is ProseMirror's. */
export function drawStrikesIn(
  view: EditorView,
  callId: string,
  s: StreamState,
) {
  // Every colour is read before any animation starts: an animation started
  // makes the next read recalculate the page's style, once per sentence.
  const strikes: { el: HTMLElement; from: Keyframe; to: Keyframe }[] = [];
  // A sentence lands from under the reading tint, so its strike starts
  // from that colour, or each landing would flash.
  const reading =
    getComputedStyle(view.dom)
      .getPropertyValue("--revision-reading-bg")
      .trim() || "transparent";
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
        backgroundColor: reading,
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

/** The widget side of `hotDecorations` and the review bar's pointer, set on
 *  the widgets as they stand so they aren't redrawn. */
export function syncWidgetClasses(
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
