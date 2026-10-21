// How a ```mermaid block becomes a picture, wherever one is drawn - the
// editor's preview (mermaid-plugin.ts), split view, exports and PDF: by
// Mermaid, or by Pele when the user picked it, with Mermaid behind it.

import type { DiagramEngine } from "../settings/SettingsContext";
import { lazyModule } from "../lazy/lazy-module";

export type MermaidApi = (typeof import("mermaid"))["default"];
const mermaidModule = lazyModule("mermaid", () =>
  import("mermaid").then(({ default: mermaid }) => mermaid),
);

/** Mermaid, loaded the first time a diagram is drawn (lazy-module.ts). */
export function loadMermaid(): Promise<MermaidApi> {
  return mermaidModule.load();
}

// Re-applied before every render pass because the diagram width follows the
// text column. Gantt charts lay themselves out at a fixed width (1200px when
// rendered offscreen, as here) and are then scaled to fit the preview box,
// which shrank their 11px labels to unreadable; at the column's own width
// they render at their real size. securityLevel "strict" is mermaid's
// default, stated because the SVG lands in the editor as innerHTML.
export function configureMermaid(
  mermaid: MermaidApi,
  width: number,
  fontFamily?: string,
  dark = appearanceIsDark(),
): void {
  mermaid.initialize({
    startOnLoad: false,
    // Follows the app's appearance - "neutral" in a dark theme left white
    // boxes and near-invisible arrows on the dark page. In the document's
    // own face rather than mermaid's "trebuchet ms".
    theme: dark ? "dark" : "neutral",
    ...(fontFamily ? { fontFamily, themeVariables: { fontFamily } } : {}),
    securityLevel: "strict",
    // A broken diagram must not draw mermaid's "Syntax error" bomb into a
    // node of its own: render() throws, and the caller keeps the source.
    suppressErrorRendering: true,
    gantt: {
      useWidth: Math.max(320, Math.round(width)),
      fontSize: 13,
      sectionFontSize: 13,
      barHeight: 22,
      barGap: 6,
      // Full dates overlapped at column width; a diagram's own axisFormat
      // directive still wins over this default.
      axisFormat: "%m-%d",
    },
  });
}

/** Whether the app is showing its dark appearance: the explicit choice
 *  (data-theme on <html>, set by SettingsContext), else the system's. */
export function appearanceIsDark(): boolean {
  // A one-design imported theme shows its light page in either appearance.
  if (document.documentElement.hasAttribute("data-light-page")) return false;
  const chosen = document.documentElement.getAttribute("data-theme");
  if (chosen === "dark") return true;
  if (chosen === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/**
 * mermaid.render, minus what it leaves behind: it measures in a temporary
 * `#d<id>` node appended to <body>, and on a failure (or when it is cut
 * short) that node stays there - a 150px block under the app that gave the
 * whole window a second scrollbar.
 */
export async function renderMermaid(
  mermaid: MermaidApi,
  id: string,
  code: string,
): Promise<string> {
  try {
    const { svg } = await mermaid.render(id, code);
    return svg;
  } finally {
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
  }
}

type PeleApi = typeof import("pele/lazy");
const peleModule = lazyModule("pele", () => import("pele/lazy"));

/** Pele's lazy entry: its core here, each diagram type a chunk of its own
 *  fetched the first time a diagram of that type is drawn. */
export function loadPele(): Promise<PeleApi> {
  return peleModule.load();
}

// Sources Pele threw on or drew nothing for. They go straight to Mermaid
// afterwards: the editor redraws a pass after every pause in typing, and
// asking Pele again each time for a diagram it can't draw only delays the
// fallback. Bounded, oldest first out - every half-typed source lands here.
const peleRefused = new Set<string>();
const REFUSED_LIMIT = 200;

function refuse(code: string): void {
  peleRefused.add(code);
  if (peleRefused.size > REFUSED_LIMIT)
    peleRefused.delete(peleRefused.values().next().value as string);
}

// A tag Mermaid draws as an HTML label: Pele's labels are SVG text, so it
// drops these. <br> and the inline bold/italic tags it does draw; `<<` opens
// a class-diagram annotation such as <<interface>>, not a tag.
const HTML_LABEL =
  /(?<!<)<(?!\/?(?:br|b|i|strong|em)\s*\/?>)\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/i;

/** Whether `code` is worth giving to Pele at all: not a source it already
 *  refused, and nothing in it that Pele is known to draw differently from
 *  Mermaid - HTML in labels, or colours set through Mermaid's
 *  themeVariables, which Pele ignores (pele.run/compatibility). */
export function peleMayDraw(code: string): boolean {
  if (peleRefused.has(code)) return false;
  if (/themeVariables/.test(code)) return false;
  return !HTML_LABEL.test(code);
}

// Link and image schemes as in html-policy.ts (ALLOWED_URL_PROTOCOLS):
// Pele's own defaults also allow tel:, which the rest of the document can't
// carry. javascript:, data: and vbscript: it blocks whatever is listed.
const PELE_LINK_SCHEMES = ["http", "https", "mailto"];
const PELE_IMAGE_SCHEMES = ["http", "https"];

/** Pele's SVG for `code`, or null when Pele threw or drew nothing - the
 *  source is then remembered (peleMayDraw) so the caller's fallback is the
 *  only renderer it sees from here on. */
export async function drawWithPele(
  code: string,
  layout: { width: number; fontFamily?: string },
): Promise<string | null> {
  try {
    const pele = await loadPele();
    const { svg } = await pele.renderAsync(code, {
      maxWidth: Math.max(320, Math.round(layout.width)),
      // The source's own direction, as Mermaid draws it: Pele turns LR into
      // TB in a narrow column, which made a diagram's export depend on how
      // wide the window was.
      autoDirection: false,
      ...(layout.fontFamily ? { fontFamily: layout.fontFamily } : {}),
      linkSchemes: PELE_LINK_SCHEMES,
      imageSchemes: PELE_IMAGE_SCHEMES,
    });
    if (svg.includes("<svg")) return svg;
  } catch {
    // An unsupported type, a syntax Pele reads differently, a size limit -
    // Mermaid may still draw it.
  }
  refuse(code);
  return null;
}

export interface DiagramLayout {
  /** The width to lay a diagram out at, in CSS px. */
  width: number;
  fontFamily?: string;
  /** Mermaid's palette; Pele's colours are CSS variables and need none. */
  dark?: boolean;
}

export interface DrawnDiagram {
  svg: string;
  /** Which engine drew it - a Pele diagram follows a theme switch through
   *  CSS, a Mermaid one has to be drawn again. */
  engine: DiagramEngine;
}

/**
 * A drawing function for one render pass: Pele first when it is the chosen
 * engine and may draw the source, Mermaid otherwise or when Pele can't.
 * Mermaid is loaded and set up (`configure`, by default the editor's
 * configureMermaid) only when a diagram first needs it, so a document Pele
 * draws in full never fetches it. Throws, as Mermaid does,
 * when neither can draw the source - callers keep it showing.
 */
export function diagramRenderer(
  engine: DiagramEngine,
  layout: DiagramLayout,
  configure: (mermaid: MermaidApi) => void = (mermaid) =>
    configureMermaid(mermaid, layout.width, layout.fontFamily, layout.dark),
): (code: string, id: string) => Promise<DrawnDiagram> {
  let mermaid: Promise<MermaidApi> | null = null;
  return async (code, id) => {
    if (engine === "pele" && peleMayDraw(code)) {
      const svg = await drawWithPele(code, layout);
      if (svg) return { svg, engine: "pele" };
    }
    mermaid ??= loadMermaid().then((api) => {
      configure(api);
      return api;
    });
    const svg = await renderMermaid(await mermaid, id, code);
    return { svg, engine: "mermaid" };
  };
}

/** Test hook: forgets which sources Pele refused. */
export function resetPeleRefusals(): void {
  peleRefused.clear();
}
