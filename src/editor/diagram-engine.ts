// How a ```mermaid block becomes a picture, wherever one is drawn: by
// Mermaid, or by Pele when the user picked it, with Mermaid behind it.

import type { DiagramEngine } from "../prefs/SettingsContext";
import { lazyModule } from "../lazy/lazy-module";

export type MermaidApi = (typeof import("mermaid"))["default"];
const mermaidModule = lazyModule("mermaid", () =>
  import("mermaid").then(({ default: mermaid }) => mermaid),
);

/** Mermaid, loaded the first time a diagram is drawn. */
export function loadMermaid(): Promise<MermaidApi> {
  return mermaidModule.load();
}

// Re-applied before every pass because the width follows the text column:
// Gantt charts laid out offscreen at 1200px and scaled down are unreadable.
// "strict" is stated because the SVG lands in the editor as innerHTML.
export function configureMermaid(
  mermaid: MermaidApi,
  width: number,
  fontFamily?: string,
  dark = appearanceIsDark(),
): void {
  mermaid.initialize({
    startOnLoad: false,
    // "neutral" in a dark theme left white boxes and near-invisible arrows.
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
      // Full dates overlap at column width; a diagram's own axisFormat still wins.
      axisFormat: "%m-%d",
    },
  });
}

/** Whether the app shows its dark appearance: the explicit choice, else the
 *  system's. */
export function appearanceIsDark(): boolean {
  // A one-design imported theme shows its light page in either appearance.
  if (document.documentElement.hasAttribute("data-light-page")) return false;
  const chosen = document.documentElement.getAttribute("data-theme");
  if (chosen === "dark") return true;
  if (chosen === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/**
 * mermaid.render, minus the temporary `#d<id>` node it leaves in <body> on a
 * failure, which gave the window a second scrollbar.
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

/** Pele's lazy entry: each diagram type is a chunk fetched on first use. */
export function loadPele(): Promise<PeleApi> {
  return peleModule.load();
}

// Sources Pele threw on or drew nothing for go straight to Mermaid after:
// the editor redraws after every pause in typing. Bounded, oldest out first.
const peleRefused = new Set<string>();
const REFUSED_LIMIT = 200;

function refuse(code: string): void {
  peleRefused.add(code);
  if (peleRefused.size > REFUSED_LIMIT)
    peleRefused.delete(peleRefused.values().next().value as string);
}

// A tag Mermaid draws as an HTML label, which Pele's SVG text drops. `<<`
// opens a class-diagram annotation, not a tag.
const HTML_LABEL =
  /(?<!<)<(?!\/?(?:br|b|i|strong|em)\s*\/?>)\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/i;

/** Whether `code` is worth giving to Pele: not already refused, and free of
 *  HTML labels and themeVariables colours, which Pele draws differently. */
export function peleMayDraw(code: string): boolean {
  if (peleRefused.has(code)) return false;
  if (/themeVariables/.test(code)) return false;
  return !HTML_LABEL.test(code);
}

// Pele's own defaults also allow tel:, which the rest of the document can't
// carry.
const PELE_LINK_SCHEMES = ["http", "https", "mailto"];
const PELE_IMAGE_SCHEMES = ["http", "https"];

/** Pele's SVG for `code`, or null when Pele threw or drew nothing; the source
 *  is then remembered as refused. */
export async function drawWithPele(
  code: string,
  layout: { width: number; fontFamily?: string },
): Promise<string | null> {
  try {
    const pele = await loadPele();
    const { svg } = await pele.renderAsync(code, {
      maxWidth: Math.max(320, Math.round(layout.width)),
      // The source's own direction: Pele turns LR into TB in a narrow column,
      // making exports depend on the window's width.
      autoDirection: false,
      ...(layout.fontFamily ? { fontFamily: layout.fontFamily } : {}),
      linkSchemes: PELE_LINK_SCHEMES,
      imageSchemes: PELE_IMAGE_SCHEMES,
    });
    if (svg.includes("<svg")) return svg;
  } catch {
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
  /** A Pele diagram follows a theme switch through CSS; a Mermaid one has to
   *  be drawn again. */
  engine: DiagramEngine;
}

/**
 * A drawing function for one render pass: Pele first when chosen and able,
 * else Mermaid, loaded only when first needed. Throws when neither can draw.
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
