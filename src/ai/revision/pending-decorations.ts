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
  streamDecorations,
  textWidget,
} from "./pending-widgets";

/**
 * Every proposal's decorations, built from the plugin state: which pieces
 * (pending-widgets.ts) each preview is drawn with in the revision view the
 * writer chose, the blocks a join strikes, the sentence under the pointer,
 * and the streaming widgets kept in step with the view.
 */

export interface SentenceHooks {
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
export const REVISION_PARTS =
  ".pending-delete, .pending-insert, .pending-pick, .pending-insert-mark, .pending-delete-mark";

export function shown(el: HTMLElement): boolean {
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

/**
 * The sentence-by-sentence layout of a rewrite streaming in, started the
 * first time it is drawn. Null where it streams in whole: no streamSource,
 * no typewriter (animation off, reduced motion), or a preview that settled
 * without ever streaming. A settled one that streamed keeps its layout
 * until its sentences arrive with the final proposal, rather than falling
 * back to one struck block for a moment.
 */
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
    anim.reveal.bySentence();
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

/** The old picture's node, while the picture that redoes it (a picture
 *  proposal's `replace`, ai/images.rs) is still being made. */
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

/**
 * The blocks whose text is all struck and that hold no new text: a
 * paragraph a rewrite folds into the one before it, or one it deletes.
 * The view that takes the originals out of the text ("final") takes
 * these out of the flow too (`pending-struck-block`): their text hidden,
 * they still stood there as empty lines with a paragraph's margins, and a
 * rewrite that joins paragraphs left blank gaps in the text. One that
 * holds the mark of a deleted sentence (`pending-struck-marked`) keeps its
 * line, where the mark shows. Read off the decorations' own `part`:
 * "struck" for an original that view hides, "text" for new text, "mark"
 * for a deleted sentence's mark.
 */
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

/** The runs of text in [from, to), without the hard breaks (and other
 *  inline leaves) between them: the darker hover tint is the text's, and a
 *  line break given it painted a box at the line's end. */
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

/**
 * The streaming side of a rewrite laid out sentence by sentence, after each
 * rebuild: the reveal is handed the view (it may have no widget to get it
 * from - nothing is drawn while a sentence repeats its original) and
 * keeps going, and the widgets of a rewrite that settled lose
 * `pending-streaming`: its ✓ / ✕ start taking clicks. A class on the
 * plugin's own widgets, not a redraw: the settle keeps every element on
 * screen as it is.
 */
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
export function drawStrikesIn(
  view: EditorView,
  callId: string,
  s: StreamState,
) {
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
