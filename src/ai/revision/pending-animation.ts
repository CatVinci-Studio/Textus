import type { EditorView } from "@milkdown/kit/prose/view";
import {
  renderDocumentHtml,
  renderMarkdownInlineHtml,
} from "../../editor/markdown/render-html";
import { onKatexReady } from "../../editor/math/katex-loader";
import {
  pendingDiagram,
  splitMermaidFences,
} from "../../editor/pending-diagram";
import { enter, glideAfter } from "../../ui/moves";
import { measure, play } from "../../ui/flip";
import { Cascade } from "../../ui/cascade";
import { UnitReveal } from "./unit-reveal";
import { showGeneratedImages, shownGeneratedSrc } from "./generated-images";
import { framePendingPictures } from "./pending-picture";
import { inlineSentence } from "./sentence-diff";
import { splitUnits } from "./unit-diff";
import {
  alignCompleted,
  partialFor,
  type StreamLayout,
} from "./sentence-stream";
import { pendingEditKey, type PendingSentence } from "./pending-types";

/** New text coming into the document: one reveal per proposal and the green
 *  text it fills in. DOM side effects only, kept outside the editor state
 *  as streamed text can arrive before its widget exists. */

export interface InsertAnimation {
  callId: string;
  /** Full text known so far - grows while the proposal streams. */
  target: string;
  /** Paces `target` onto the screen a unit at a time. */
  reveal: UnitReveal;
  /** The text the widget last drew: a frame with nothing new draws
   *  nothing, so the DOM under the caret stays as it is. */
  drawn: string | null;
  /** False while more streamed text may still arrive (keeps the caret). */
  done: boolean;
  span: HTMLSpanElement | null;
  frame: number | null;
  /** The view that drew the widget - the reveal's only way to dispatch the
   *  `settle` meta that finally offers Accept/Reject for this preview. */
  view: EditorView | null;
  /** The settle meta was dispatched - never dispatch it twice. */
  settled: boolean;
  /** Its text is whole but the call's own arguments aren't in yet: it
   *  lands, and stays undecided. */
  awaitingFinal: boolean;
  /** Set when the text is laid out sentence by sentence as it streams;
   *  `span` is then only the sentence being written. */
  stream: StreamState | null;
  /** New text in a line of a paragraph: what of it has come in, for the
   *  next batch to fade in on its own. */
  words: Cascade | null;
}

/** A rewrite being laid out sentence by sentence while it streams. */
export interface StreamState {
  /** The original's sentences (markdown). */
  sentences: string[];
  layout: StreamLayout;
  /** The completed text `layout.pieces` were aligned for: the alignment
   *  only runs again when a sentence completes, not on every frame. */
  alignedFor: string | null;
  /** The most originals the stream has reached: a later layout never
   *  hands one back. */
  reached: number;
  /** `layoutSignature` of the layout the decorations were last built
   *  from: a different one asks for a rebuild (`relayout`). */
  drawn: string;
  relayoutQueued: boolean;
  /** The new text each change's widget was drawn with, by change index, to
   *  tell a just-completed sentence from one a re-alignment changed. */
  shown: Map<number, { after: string; at: number }>;
  /** The change index the sentence being written was drawn as. */
  partialIndex: number | null;
  /** The struck originals whose strike has drawn in. */
  struck: Set<string>;
  /** Set once stopped mid-stream: the text it keeps. */
  stopped?: string | null;
  /** The completed changes as last drawn. */
  changes: PendingSentence[];
  /** When the text last landed: the beat its changes enter on, in the text
   *  and in the margin. */
  landedAt: number;
}

export const animations = new Map<string, InsertAnimation>();

export function newAnimation(
  callId: string,
  text: string,
  done: boolean,
): InsertAnimation {
  // Text lands a paragraph at a time - new writing, and a rewrite laid out
  // sentence by sentence (StreamState) too.
  const reveal = new UnitReveal(true);
  reveal.update(text, done, performance.now());
  return {
    callId,
    target: text,
    reveal,
    drawn: null,
    done,
    span: null,
    frame: null,
    view: null,
    settled: false,
    awaitingFinal: false,
    stream: null,
    words: null,
  };
}

/** The layout's shape - what decides whether the decorations must be
 *  rebuilt; the partial sentence's growing text is not part of it (its span
 *  is updated in place). */
export function layoutSignature(layout: StreamLayout): string {
  const pieces = layout.pieces
    .map((p) =>
      p.kind === "same"
        ? `s${p.start}`
        : `c${p.start}-${p.end}:${textKey(p.after)}`,
    )
    .join(",");
  // Without a partial sentence the progress cursor stands on `reached`.
  const partial = layout.partial
    ? `${layout.partial.rewrites ?? "i"}@${layout.partial.at}`
    : `-${layout.reached}`;
  return `${pieces}|${partial}`;
}

/** A short, stable key for a widget's text: a widget with the same key is
 *  kept as it is, so its key has to change with what it shows. */
export function textKey(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++)
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The streaming rewrite's layout for what is on screen now: completed
 *  sentences aligned when one completes, the partial one every frame. */
export function refreshStream(anim: InsertAnimation) {
  const s = anim.stream;
  if (!s) return;
  const done = anim.done && anim.reveal.caughtUp;
  const pieces = splitUnits(anim.reveal.text);
  // What is on screen ends where a unit does, unless a pause landed one
  // partway: then its last piece is still being written.
  const completed =
    done || anim.reveal.endsOnUnit ? pieces : pieces.slice(0, -1);
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
    s.landedAt = performance.now();
    // Done reaches every original; a stop's text is laid out against what
    // the stream itself had reached.
    if (!done) s.reached = Math.max(s.reached, reached);
  }
  s.layout = {
    pieces: aligned,
    reached,
    partial: done
      ? null
      : anim.reveal.endsOnUnit
        ? null
        : partialFor(s.sentences, (pieces.at(-1) ?? "").trim(), reached),
  };
  if (layoutSignature(s.layout) !== s.drawn) queueRelayout(anim);
}

/** Rebuilds the decorations after the current dispatch (this runs inside
 *  decoration draws too) but before paint; the text below glides. */
export function queueRelayout(anim: InsertAnimation) {
  const s = anim.stream;
  const view = anim.view;
  if (!s || !view || s.relayoutQueued) return;
  s.relayoutQueued = true;
  queueMicrotask(() => {
    s.relayoutQueued = false;
    if (view.isDestroyed || animations.get(anim.callId) !== anim) return;
    const before = measure(onScreenBlocks(view.dom));
    view.dispatch(
      view.state.tr.setMeta(pendingEditKey, {
        type: "relayout",
        callId: anim.callId,
      }),
    );
    play(before, { duration: "--dur-medium", easing: "--ease-out" });
  });
}

/** The document's top-level blocks on screen - the ones a landing can move
 *  where the eye is. */
function onScreenBlocks(root: HTMLElement): Element[] {
  const bottom = window.innerHeight;
  return [...root.children].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < bottom;
  });
}

export function updateAnimation(
  anim: InsertAnimation,
  text: string,
  done: boolean,
) {
  anim.target = text;
  anim.done = done;
  anim.reveal.update(text, done, performance.now());
}

/** Whether the callId's text is still being revealed or may still grow;
 *  the preview stays undecidable meanwhile. */
export function stillRevealing(callId: string): boolean {
  const anim = animations.get(callId);
  if (!anim) return false;
  // Empty text is done only once the arguments are final (a `delete` has no
  // widget to settle it); mid-stream it means none has arrived yet.
  if (anim.awaitingFinal) return true;
  if (anim.target.length === 0) return !anim.done;
  return !anim.done || !anim.reveal.caughtUp;
}

/** Once the reveal completes, settles the preview. Deferred a tick, as this
 *  also runs inside decoration draws, where dispatch can't re-enter. */
export function maybeSettle(callId: string) {
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

export function stopFrame(anim: InsertAnimation) {
  if (anim.frame !== null) {
    cancelAnimationFrame(anim.frame);
    anim.frame = null;
  }
}

export function renderAnimation(anim: InsertAnimation) {
  if (!anim.span) return;
  const text = anim.stream
    ? inlineSentence(anim.stream.layout.partial?.text ?? "")
    : anim.reveal.text;
  anim.span.classList.toggle(
    "pending-insert-typing",
    !anim.reveal.caughtUp || !anim.done,
  );
  // Drawn only when what it shows changed: WebKit scrolls the caret back
  // into view on each DOM change under it.
  const fresh = anim.span.dataset.drawn !== "true";
  if (text === anim.drawn && !fresh) return;
  // A widget made again (its decoration redrawn) shows what was on screen
  // already: drawn, nothing entering.
  const redrawn = fresh && anim.drawn !== null && text === anim.drawn;
  const shown = fresh ? "" : (anim.drawn ?? "");
  const before = fresh ? 0 : anim.span.children.length;
  const height = fresh ? 0 : anim.span.offsetHeight;
  renderPendingHtml(anim.span, text);
  anim.drawn = text;
  anim.span.dataset.drawn = "true";
  // Each landed block fades in rising, all at once. Text replaced rather
  // than added to shows at once.
  if (redrawn || !text.startsWith(shown)) return;
  // In a line of a paragraph the landed batch fades in as one; what was
  // there before stays.
  if (anim.span.dataset.blocks !== "true") {
    anim.words ??= new Cascade();
    if (fresh) anim.words.settle(anim.span);
    else anim.words.play(anim.span, { together: true });
    return;
  }
  for (const el of [...anim.span.children].slice(before))
    enter(el, { from: "up", distance: "md", duration: "--dur-slow" });
  // The text below glides down, measured in a microtask: after ProseMirror
  // puts the widget in, before paint, so nothing jumps for a frame.
  const span = anim.span;
  const push = () => {
    const root = span.closest(".ProseMirror");
    if (root) glideAfter(span, span.offsetHeight - height, root);
  };
  if (span.isConnected) push();
  else queueMicrotask(push);
}

/** New text into its widget, as rendered Markdown, each line its own tinted
 *  span: one box over several lines paints padding at every line end. */
export function renderPendingHtml(span: HTMLElement, markdown: string) {
  fillPendingHtml(span, markdown);
  if (span.querySelector(".math-pending")) awaitKatex(span, markdown);
  else waitingForKatex.delete(span);
}

// Widgets showing a formula's source while KaTeX loads, redrawn once it is
// here, since a widget kept by its key wouldn't be.
export const waitingForKatex = new Map<HTMLElement, string>();

export function awaitKatex(span: HTMLElement, markdown: string) {
  if (waitingForKatex.size === 0)
    onKatexReady(() => {
      for (const [waiting, text] of waitingForKatex)
        if (waiting.isConnected) fillPendingHtml(waiting, text);
      waitingForKatex.clear();
    });
  waitingForKatex.set(span, markdown);
}

export function fillPendingHtml(span: HTMLElement, source: string) {
  fillPendingContent(span, source);
  // A picture still being made is its frame until it comes.
  framePendingPictures(span);
}

/** A waiting picture's placeholder, as an address the document renderer's
 *  HTML policy keeps (it drops blob: and textus-generated:). */
export const PICTURE_STAND_IN = "https://textus.invalid/generated/";

/** New text between two blocks, rendered as the blocks it will be, as
 *  inline text would show its Markdown. */
export function fillPendingBlocks(el: HTMLElement, source: string) {
  const parts = splitMermaidFences(source) ?? [
    { kind: "text" as const, text: source },
  ];
  const previous = el.querySelectorAll<HTMLElement>(".pending-diagram");
  let diagrams = 0;
  const nodes = parts.flatMap((part) => {
    if (part.kind === "diagram")
      return [pendingDiagram(part, previous[diagrams++])];
    const html = document.createElement("template");
    html.innerHTML = renderDocumentHtml(
      part.text.replace(/textus-generated:/g, PICTURE_STAND_IN),
    );
    for (const img of html.content.querySelectorAll("img")) {
      const src = img.getAttribute("src") ?? "";
      if (src.startsWith(PICTURE_STAND_IN))
        img.setAttribute(
          "src",
          shownGeneratedSrc(src.slice(PICTURE_STAND_IN.length)),
        );
    }
    return [...html.content.childNodes];
  });
  el.replaceChildren(...nodes);
}

/** Text that is blocks of its own: more than one paragraph, or a
 *  heading, a list, a quote, a table, a fence or a formula. */
export function hasBlocks(text: string): boolean {
  return (
    /\n[ \t]*\n/.test(text.trim()) ||
    /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|\$\$)/m.test(text)
  );
}

export function fillPendingContent(span: HTMLElement, source: string) {
  // A widget is made once, often before any of its text has come: text at
  // the caret that turns out to be blocks becomes blocks when it does.
  if (
    span.dataset.blocks !== "true" &&
    span.classList.contains("pending-whole") &&
    hasBlocks(source)
  ) {
    span.dataset.blocks = "true";
    span.classList.add("pending-blocks");
    span.classList.remove("pending-insert-lines");
  }
  if (span.dataset.blocks === "true") {
    fillPendingBlocks(span, source);
    return;
  }
  // A proposed picture (generate_image) is drawn from its bytes, which
  // only the preview holds.
  const markdown = showGeneratedImages(source);
  const parts = splitMermaidFences(markdown);
  let nodes: Node[];
  if (!parts) {
    span.innerHTML = renderMarkdownInlineHtml(markdown);
    nodes = [...span.childNodes];
  } else {
    // A ```mermaid fence is drawn as its diagram, keeping its element across
    // the typewriter's frames.
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
export function ensureTicking(anim: InsertAnimation) {
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

export function dropAnimation(callId: string) {
  const anim = animations.get(callId);
  if (!anim) return;
  stopFrame(anim);
  animations.delete(callId);
}

/** Feeds streamed text into the callId's green widget, and once more with
 *  `done`. The widget picks the state up whenever it is created. */
export function streamPendingInsertText(
  callId: string,
  text: string,
  done: boolean,
  final = done,
) {
  const existing = animations.get(callId);
  if (!existing) {
    const anim = newAnimation(callId, text, done);
    anim.awaitingFinal = done && !final;
    animations.set(callId, anim);
    return;
  }
  existing.awaitingFinal = done && !final;
  // `done` can reopen: a widget drawn early creates the entry with
  // done=true, or the reveal would settle mid-stream.
  updateAnimation(existing, text, done);
  ensureTicking(existing);
  renderAnimation(existing);
  maybeSettle(callId);
}

/** What a stopped rewrite keeps, as it reads on screen: completed sentences,
 *  then originals not reached. Half a sentence goes. Null: none completed;
 *  undefined: not laid out by sentence. */
export function stopRewrite(
  callId: string,
  text: string,
): string | null | undefined {
  const s = animations.get(callId)?.stream;
  if (!s) return undefined;
  s.stopped ??= keptOnStop(s, text);
  return s.stopped;
}

/** What `stopRewrite` kept of the callId's rewrite, also for the stopped
 *  turn's re-add. Undefined when not stopped or not laid out by sentence. */
export function stoppedRewrite(callId: string): string | null | undefined {
  return animations.get(callId)?.stream?.stopped;
}

export function keptOnStop(s: StreamState, text: string): string | null {
  const pieces = splitUnits(text);
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
