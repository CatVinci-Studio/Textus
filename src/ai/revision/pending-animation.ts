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

/**
 * New text coming into the document: one reveal per proposal (UnitReveal:
 * a sentence or a block at a time, each entering as it lands) and the green
 * text it fills in as it goes - Markdown rendered inline or
 * as blocks, diagrams and maths when ready, pictures in their frames - and
 * what a stopped rewrite keeps. DOM side effects only, outside the editor
 * state (pending-edit-plugin.ts).
 */

export interface InsertAnimation {
  callId: string;
  /** Full text known so far - grows while the proposal streams. */
  target: string;
  /** Paces `target` onto the screen a unit at a time (unit-reveal.ts). */
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
   *  lands, and stays undecided (ProposalStreamEffects.feed's `final`). */
  awaitingFinal: boolean;
  /** Set when the text is laid out sentence by sentence as it streams
   *  (PendingPreview.streamSource); `span` is then only the sentence being
   *  written. */
  stream: StreamState | null;
  /** New text in a line of a paragraph: what of it has come in, for the
   *  next batch to fade in on its own (renderAnimation). */
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
  /** When the text last landed - a paragraph rewritten whole: the beat its
   *  changes enter on, in the text and in the margin (ui/moves.ts). */
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

/**
 * The streaming rewrite's layout for what is on screen now (the reveal's
 * text, not what has arrived): completed sentences are aligned when one
 * completes, the sentence being written is placed every frame. Asks for a
 * rebuild when the shape changed.
 */
export function refreshStream(anim: InsertAnimation) {
  const s = anim.stream;
  if (!s) return;
  const done = anim.done && anim.reveal.caughtUp;
  const pieces = splitUnits(anim.reveal.text);
  // What is on screen ends where a unit does (unit-reveal.ts), unless a
  // pause landed one partway: then its last piece is still being written.
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

/** Rebuilds the decorations from the new layout - after the current
 *  dispatch (this is reached from inside a decoration draw too), but before
 *  the frame is painted. What landed may grow its paragraph: the text below
 *  glides to its new place rather than jumping there (ui/flip.ts). */
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

/** Whether the callId's text is still being revealed (or may still grow) -
 *  while true, the preview must stay in the un-decidable "streaming" state
 *  even after the final proposal arguments have landed. */
export function stillRevealing(callId: string): boolean {
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
  if (anim.awaitingFinal) return true;
  if (anim.target.length === 0) return !anim.done;
  return !anim.done || !anim.reveal.caughtUp;
}

/** Once the reveal completes, flips the preview out of `streaming` via a
 *  plugin meta so Accept/Reject finally show. Deferred a tick: this is
 *  reached from animation frames but also from inside decoration draws,
 *  where a reentrant dispatch is not allowed. */
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
  // Drawn only when what it shows changed: redrawn every frame, the DOM
  // under the caret changed sixty times a second and WebKit scrolled the
  // caret back into view each time - the document wouldn't scroll away
  // while a proposal was written.
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
  // Each block that landed - a paragraph written whole - fades in rising
  // from a little below (ui/moves.ts), all of it at once: a sentence or a
  // word at a time, the writing came in jerks. A fence growing a line at a
  // time is drawn again in place (its diagram builds itself up). Text
  // replaced rather than added to shows at once.
  if (redrawn || !text.startsWith(shown)) return;
  // In a line of a paragraph there are no blocks to rise: the batch that
  // landed fades in as one, what was there before staying as it was (the
  // widget's first text fades in with the widget, milkdown-theme.css).
  if (anim.span.dataset.blocks !== "true") {
    anim.words ??= new Cascade();
    if (fresh) anim.words.settle(anim.span);
    else anim.words.play(anim.span, { together: true });
    return;
  }
  for (const el of [...anim.span.children].slice(before))
    enter(el, { from: "up", distance: "md", duration: "--dur-slow" });
  // The text below it, pushed down by what landed, glides there - once
  // the widget is in the document, when it was drawn as it was made: in a
  // microtask, which runs once ProseMirror has put it in and before the
  // frame is painted. On the next frame, the text stood a frame where it
  // was pushed to and then went back up to glide down.
  const span = anim.span;
  const push = () => {
    const root = span.closest(".ProseMirror");
    if (root) glideAfter(span, span.offsetHeight - height, root);
  };
  if (span.isConnected) push();
  else queueMicrotask(push);
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
export function renderPendingHtml(span: HTMLElement, markdown: string) {
  fillPendingHtml(span, markdown);
  if (span.querySelector(".math-pending")) awaitKatex(span, markdown);
  else waitingForKatex.delete(span);
}

// The widgets showing a formula's source while KaTeX loads (katex-loader.ts),
// with the markdown each shows. A widget is kept by its key across
// transactions, so nothing else would draw it again once KaTeX is here: it
// would show the source until the proposal next changed.
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
  // A picture not here yet - still being made - is its frame until it
  // comes (pending-picture.ts).
  framePendingPictures(span);
}

/** A waiting picture's placeholder, as an address the document renderer's
 *  HTML policy keeps (it drops blob: and textus-generated:). */
export const PICTURE_STAND_IN = "https://textus.invalid/generated/";

/**
 * New text between two blocks, as the blocks it will be: paragraphs,
 * lists, headings, tables, display math and footnotes rendered as the
 * document renders them (renderDocumentHtml) - drawn inline, as one
 * paragraph's run of text, they showed as their Markdown, "- one", "[^2]:
 * …", with line breaks between (rc.5). A ```mermaid fence is its diagram,
 * and a waiting picture its frame, as inline.
 */
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
