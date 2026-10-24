// A ```mermaid block in text that isn't in the document yet - Textus AI's
// proposal, drawn as a widget by ai/revision/pending-edit-plugin.ts - drawn
// as a diagram instead of shown as source. While the proposal streams in,
// the diagram grows with it: drawn again from each complete line, at most
// every THROTTLE_MS, with only the parts new since the last drawing fading
// in. The drawing itself is the editor's own (mermaid-plugin.ts registers
// it per editor), so the engine, width and appearance match the diagrams
// in the document, and an accepted diagram is already drawn.

import { renderMarkdownInlineHtml } from "./markdown/render-html";
import { animate, duration } from "../ui/motion";

/** A run of Markdown text, or a ```mermaid fence in it. */
export type DiagramPart =
  | { kind: "text"; text: string }
  | {
      kind: "diagram";
      /** What to draw: the fence's body, or while its closing fence hasn't
       *  arrived, the body's complete lines - a line cut off mid-token
       *  would only fail to parse or draw a half-typed label. */
      code: string;
      /** The fence as written so far, shown until a drawing succeeds. */
      raw: string;
    };

const OPENING = /^```mermaid[ \t]*$/m;
const CLOSING = /^```[ \t]*$/m;

/** `markdown` cut into text and ```mermaid fences, including one still
 *  open at its end. Null when there is no fence in it at all. */
export function splitMermaidFences(markdown: string): DiagramPart[] | null {
  if (!OPENING.test(markdown)) return null;
  const parts: DiagramPart[] = [];
  let rest = markdown;
  while (rest) {
    const open = OPENING.exec(rest);
    if (!open) {
      parts.push({ kind: "text", text: rest });
      break;
    }
    if (open.index > 0)
      parts.push({ kind: "text", text: rest.slice(0, open.index) });
    const afterOpen = rest.slice(open.index + open[0].length);
    const body = afterOpen.startsWith("\n") ? afterOpen.slice(1) : "";
    const close = CLOSING.exec(body);
    if (!close) {
      parts.push({
        kind: "diagram",
        code: body.slice(0, body.lastIndexOf("\n") + 1).trimEnd(),
        raw: rest.slice(open.index),
      });
      break;
    }
    const end = open.index + open[0].length + 1 + close.index + close[0].length;
    parts.push({
      kind: "diagram",
      code: body.slice(0, close.index).trimEnd(),
      raw: rest.slice(open.index, end),
    });
    rest = rest.slice(end);
  }
  // The line breaks around a fence: the diagram is a box of its own.
  return parts.flatMap((part, i): DiagramPart[] => {
    if (part.kind === "diagram") return [part];
    let text = part.text;
    if (parts[i - 1]?.kind === "diagram") text = text.replace(/^\n+/, "");
    if (parts[i + 1]?.kind === "diagram") text = text.replace(/\n+$/, "");
    return text ? [{ ...part, text }] : [];
  });
}

/** Draws `code` the way the editor draws its diagrams; throws when it
 *  can't be drawn. `idPrefix`: the render id the SVG's own ids start with. */
export type PendingDrawer = (
  code: string,
) => Promise<{ svg: string; idPrefix: string }>;

// By editor root (view.dom): a widget finds its editor's drawer from where
// it stands, so the widget code needs no handle on the editor's settings.
const drawers = new WeakMap<Element, PendingDrawer>();

export function registerPendingDrawer(
  root: HTMLElement,
  draw: PendingDrawer | null,
): void {
  if (draw) drawers.set(root, draw);
  else drawers.delete(root);
}

/** At most one drawing of a growing diagram per this many ms: each one
 *  lays the whole diagram out again. */
const THROTTLE_MS = 200;

interface DiagramState {
  /** The source to draw next. */
  wanted: string;
  /** The source of the drawing on screen (null: none yet, `raw` shows). */
  shown: string | null;
  raw: string;
  /** The drawn parts' keys (`partKey`), to tell the next drawing's new ones. */
  keys: Set<string>;
  busy: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  last: number;
  /** Drawn for another engine or appearance: draw again though unchanged. */
  stale: boolean;
}

const states = new WeakMap<HTMLElement, DiagramState>();

/**
 * The element showing one fence of a pending insert: `reuse` (the one the
 * same fence had in the widget's last render, so a drawing survives the
 * typewriter's re-render of the text every frame) or a new one. Asks for a
 * drawing when the fence's source changed.
 */
export function pendingDiagram(
  part: Extract<DiagramPart, { kind: "diagram" }>,
  reuse?: HTMLElement,
): HTMLElement {
  let el = reuse;
  let state = el && states.get(el);
  if (!el || !state) {
    el = document.createElement("span");
    el.className = "mermaid-preview pending-diagram";
    state = {
      wanted: "",
      shown: null,
      raw: "",
      keys: new Set(),
      busy: false,
      timer: undefined,
      last: 0,
      stale: false,
    };
    states.set(el, state);
  }
  if (state.shown === null && part.raw !== state.raw)
    el.innerHTML = renderMarkdownInlineHtml(part.raw);
  state.raw = part.raw;
  if (part.code !== state.wanted) {
    state.wanted = part.code;
    schedule(el, state);
  }
  return el;
}

/** The engine or the appearance changed: the pending diagrams under `root`
 *  are drawn again, as the document's are. */
export function redrawPendingDiagrams(root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>(".pending-diagram")) {
    const state = states.get(el);
    if (!state || state.shown === null) continue;
    state.stale = true;
    schedule(el, state);
  }
}

function schedule(el: HTMLElement, state: DiagramState) {
  // A drawing in flight asks again when it lands.
  if (state.busy || state.timer !== undefined) return;
  // Never on the typing path: a frame of the typewriter only notes the
  // source, the drawing comes after it.
  const wait = Math.max(0, state.last + THROTTLE_MS - performance.now());
  state.timer = setTimeout(() => {
    state.timer = undefined;
    void draw(el, state);
  }, wait);
}

async function draw(el: HTMLElement, state: DiagramState) {
  const code = state.wanted;
  if (!code.trim() || (code === state.shown && !state.stale)) return;
  const drawer = el.isConnected
    ? drawers.get(el.closest(".ProseMirror") ?? el)
    : undefined;
  // Rejected, or diagrams are off (no drawer): the source stays.
  if (!drawer) return;
  state.busy = true;
  state.last = performance.now();
  try {
    const { svg, idPrefix } = await drawer(code);
    if (el.isConnected) {
      showDrawing(el, state, svg, idPrefix);
      state.shown = code;
      state.stale = false;
    }
  } catch {
    // Not a diagram (yet): the last good drawing, or the source, stays.
  } finally {
    state.busy = false;
    if (state.wanted !== code && el.isConnected) schedule(el, state);
  }
}

/** A part of a drawing by what it stands for, not by the render: Mermaid's
 *  ids carry the render's id first, Pele marks nodes and edges with
 *  data-id. */
function partKey(el: Element, idPrefix: string): string {
  if (el.id) return `#${el.id.replace(idPrefix, "")}`;
  return `${el.tagName}.${el.getAttribute("class") ?? ""}@${el.getAttribute("data-id")}`;
}

function showDrawing(
  el: HTMLElement,
  state: DiagramState,
  svg: string,
  idPrefix: string,
) {
  const first = state.shown === null;
  // Where each part stood: drawn again, the layout moves them.
  const before = new Map<string, DOMRect>();
  for (const part of outermostParts(el.querySelector("svg")))
    before.set(partKey(part, idPrefix), part.getBoundingClientRect());
  el.innerHTML = svg;
  el.classList.add("pending-diagram-drawn");
  const root = el.querySelector("svg");
  if (!root) return;
  const keys = new Set<string>();
  for (const part of root.querySelectorAll("[id], [data-id]"))
    keys.add(partKey(part, idPrefix));
  // The parts this drawing added come in one after another, its nodes
  // first and then what joins them - the first drawing too, built up rather
  // than faded in whole; the parts it had glide from where they stood to
  // where the new layout puts them (FLIP, by the `translate` property: a
  // part's own `transform` attribute stays as Mermaid set it).
  const parts = outermostParts(root);
  const fresh = parts
    .filter((part) => first || !state.keys.has(partKey(part, idPrefix)))
    .sort((a, b) => Number(isNode(b)) - Number(isNode(a)));
  const gap = Math.min(
    duration("--dur-stagger") * 3,
    duration("--dur-cascade") / Math.max(1, fresh.length),
  );
  fresh.forEach((part, i) => {
    part.classList.add("diagram-part-enter");
    (part as SVGElement).style.animationDelay = `${Math.round(i * gap)}ms`;
  });
  const scale = root.getScreenCTM()?.a || 1;
  for (const part of parts) {
    const was = before.get(partKey(part, idPrefix));
    if (!was || fresh.includes(part)) continue;
    const now = part.getBoundingClientRect();
    const dx = (was.left - now.left) / scale;
    const dy = (was.top - now.top) / scale;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    animate(part, [{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], {
      duration: "--dur-slow",
      easing: "--ease-out",
    });
  }
  state.keys = keys;
}

/** A drawing's parts that stand for something - a node, an edge, a label -
 *  and aren't inside another, nor in its <defs>: a fade inside a fading
 *  group compounds. */
function outermostParts(root: Element | null): Element[] {
  if (!root) return [];
  const isPart = (e: Element) => e.matches("[id], [data-id]");
  return [...root.querySelectorAll("[id], [data-id]")].filter((part) => {
    if (part.closest("defs, style")) return false;
    for (let up = part.parentElement; up && up !== root; up = up.parentElement)
      if (isPart(up)) return false;
    return true;
  });
}

/** Whether a part is a node: Mermaid's `.node`, Pele's `.pele-node`. */
function isNode(part: Element): boolean {
  return (
    part.classList.contains("node") || part.classList.contains("pele-node")
  );
}
