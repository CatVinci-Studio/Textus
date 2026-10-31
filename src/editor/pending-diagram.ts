// A ```mermaid (or ```chart) block in an AI proposal not yet in the document, drawn as a
// diagram that grows as the proposal streams in, new parts fading in. The
// editor's own drawer draws it, so it matches the document's diagrams.

import { renderMarkdownInlineHtml } from "./markdown/render-html";
import { animate, duration } from "../ui/motion";

/** A run of Markdown text, or a ```mermaid fence in it. */
export type DiagramPart =
  | { kind: "text"; text: string }
  | {
      kind: "diagram";
      /** The fence's language: "mermaid" or "chart". */
      language: string;
      /** What to draw: the fence's body, or while it is still open, its
       *  complete lines; a half line would only fail to parse. */
      code: string;
      /** The fence as written so far, shown until a drawing succeeds. */
      raw: string;
    };

const OPENING = /^```(mermaid|chart)[ \t]*$/m;
const CLOSING = /^```[ \t]*$/m;

/** `markdown` cut into text and ```mermaid and ```chart fences, including one still open
 *  at its end. Null when there is no fence. */
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
        language: open[1],
        code: body.slice(0, body.lastIndexOf("\n") + 1).trimEnd(),
        raw: rest.slice(open.index),
      });
      break;
    }
    const end = open.index + open[0].length + 1 + close.index + close[0].length;
    parts.push({
      kind: "diagram",
      language: open[1],
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
  language: string,
) => Promise<{ svg: string; idPrefix: string }>;

// By editor root: a widget finds its editor's drawer from where it stands.
const drawers = new WeakMap<Element, PendingDrawer>();

export function registerPendingDrawer(
  root: HTMLElement,
  draw: PendingDrawer | null,
): void {
  if (draw) drawers.set(root, draw);
  else drawers.delete(root);
}

/** At most one drawing of a growing diagram per this many ms: each lays the
 *  whole diagram out again. */
const THROTTLE_MS = 200;

interface DiagramState {
  /** The source to draw next, and its fence's language. */
  wanted: string;
  language: string;
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
 * The element showing one fence of a pending insert: `reuse`, so a drawing
 * survives the widget's re-render every frame, or a new one. Asks for a
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
      language: part.language,
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
  if (part.code !== state.wanted || part.language !== state.language) {
    state.wanted = part.code;
    state.language = part.language;
    schedule(el, state);
  }
  return el;
}

/** The engine or appearance changed: the pending diagrams under `root` are
 *  drawn again. */
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
  // Never on the typing path: a frame only notes the source; the drawing
  // comes after.
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
    const { svg, idPrefix } = await drawer(code, state.language);
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
 *  ids carry the render id first; Pele marks parts with data-id. */
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
  // New parts come in one after another, nodes first; parts it already had
  // glide to their new place (FLIP via `translate`, leaving the part's own
  // `transform` attribute as Mermaid set it).
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

/** A drawing's parts that stand for something and aren't inside another or
 *  in <defs>: a fade inside a fading group compounds. */
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
