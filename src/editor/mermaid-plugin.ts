import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  applyReveal,
  buildReveal,
  emptyReveal,
  type RevealState,
} from "./reveal-state";
import { isLargeDoc } from "./large-doc";

const mermaidKey = new PluginKey("mermaid-preview");
const DEBOUNCE_MS = 500;
type MermaidApi = (typeof import("mermaid"))["default"];
let mermaidPromise: Promise<MermaidApi> | null = null;
// Render ids are unique across every editor, not per editor: two tabs
// rendering at startup both used "mermaid-preview-1-0", and the first one
// to finish removed the other's measuring node mid-render (renderMermaid's
// cleanup), so the diagram in the other tab failed and stayed raw source.
let renderIdCounter = 0;

export function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import("mermaid").then(({ default: mermaid }) => mermaid);
  return mermaidPromise;
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

// Cheap stable hash of a diagram's source, for the widget key below.
function hashCode(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

interface MermaidBlock {
  from: number;
  to: number;
  code: string;
}

function collectMermaidBlocks(doc: EditorState["doc"]): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "code_block" && node.attrs.language === "mermaid") {
      blocks.push({
        from: pos,
        to: pos + node.nodeSize,
        code: node.textContent,
      });
    }
  });
  return blocks;
}

/**
 * Renders a live diagram preview below any fenced code block whose language
 * is "mermaid", as a widget decoration. While the cursor is away from a
 * successfully-rendered block, its raw fenced source is hidden (mirroring
 * math-preview-plugin's source/render swap) so only the diagram shows;
 * moving the cursor back into the block - or clicking the diagram - reveals
 * the source again for editing.
 */
export function createMermaidPreviewPlugin(options: {
  enabled: () => boolean;
}) {
  return $prose(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    // Per editor instance: rendering in one open tab must not cancel a
    // render already in flight in another tab.
    let renderSeq = 0;
    // Keyed by the block's exact source text rather than its doc position -
    // an edit anywhere earlier in the document shifts every later block's
    // position on every keystroke, which would otherwise miss this cache
    // (position-keyed) on every one of those keystrokes and flash the raw
    // source back until the next debounced render, even though the diagram
    // itself never changed.
    let lastRenders = new Map<string, string>();
    // The width lastRenders was laid out at: a pass at the same width only
    // renders sources it hasn't seen, instead of every diagram again 500ms
    // after each keystroke anywhere in the document.
    let lastWidth = 0;
    // And the appearance and face it was drawn in (see configureMermaid).
    let lastStyle = "";
    // Bumped whenever a pass draws every diagram afresh (a new width or
    // appearance). Part of each widget's key: with the source alone as the
    // key, ProseMirror kept the old widget DOM, so a switch to dark redrew
    // the diagrams and still showed the light ones.
    let renderGeneration = 0;

    function buildDecorations(state: EditorState): RevealState {
      if (!options.enabled()) return emptyReveal;
      return buildReveal(state, (touches) =>
        collectDecorations(state, touches),
      );
    }

    function collectDecorations(
      state: EditorState,
      touches: (from: number, to: number) => boolean,
    ): Decoration[] {
      const decorations: Decoration[] = [];
      const seen = new Map<string, number>();
      for (const { from, to, code } of collectMermaidBlocks(state.doc)) {
        const nth = seen.get(code) ?? 0;
        seen.set(code, nth + 1);
        const svg = lastRenders.get(code);
        if (!svg) continue;
        if (touches(from, to)) continue; // editing it - keep source visible

        decorations.push(
          Decoration.node(from, to, { class: "mermaid-source-hidden" }),
        );
        decorations.push(
          Decoration.widget(
            to,
            (view: EditorView, getPos: () => number | undefined) => {
              const container = document.createElement("div");
              container.className = "mermaid-preview";
              container.innerHTML = svg;
              container.addEventListener("mousedown", (event) => {
                event.preventDefault();
                // The widget's DOM outlives edits above it (its key leaves
                // the position out), so where its block starts is asked now:
                // the `from` of the pass that built it can be another block.
                const end = getPos();
                if (end === undefined) return;
                const block = view.state.doc.resolve(end).nodeBefore;
                if (block?.type.name !== "code_block") return;
                const tr = view.state.tr.setSelection(
                  TextSelection.create(
                    view.state.doc,
                    end - block.nodeSize + 1,
                  ),
                );
                view.dispatch(tr);
                view.focus();
              });
              return container;
            },
            // ProseMirror reuses a widget's DOM while its key is unchanged, so
            // a position-only key kept showing the OLD diagram after its
            // source was edited in place: the source is part of the key. The
            // position is not - typing above a diagram moves it, and a key
            // that moved with it rebuilt the SVG on every keystroke. Which
            // repeat of an identical source it is tells copies apart.
            {
              side: 1,
              key: `mermaid-${hashCode(code)}-${nth}-${renderGeneration}`,
            },
          ),
        );
      }
      return decorations;
    }

    return new Plugin<RevealState>({
      key: mermaidKey,
      state: {
        init: (_config, state) => buildDecorations(state),
        apply(tr, prev, oldState, newState) {
          // A finished render has new SVG to show whatever the caret did.
          if (tr.getMeta(mermaidKey) === "rerender")
            return buildDecorations(newState);
          return applyReveal(tr, prev, oldState, newState, buildDecorations);
        },
      },
      props: {
        decorations(state) {
          return mermaidKey.getState(state)?.set;
        },
      },
      view(editorView) {
        async function renderAll() {
          if (!options.enabled()) {
            lastRenders = new Map();
            editorView.dispatch(
              editorView.state.tr.setMeta(mermaidKey, "rerender"),
            );
            return;
          }

          // A tab opened in the background is display:none: nothing can be
          // measured there, and mermaid laid diagrams out at zero width or
          // failed outright. Render once it is shown (the observer below).
          if (editorView.dom.clientWidth === 0) {
            waitingToBeShown = true;
            return;
          }
          waitingToBeShown = false;

          const mySeq = ++renderSeq;
          const blocks = collectMermaidBlocks(editorView.state.doc);
          if (blocks.length === 0) {
            lastRenders = new Map();
            editorView.dispatch(
              editorView.state.tr.setMeta(mermaidKey, "rerender"),
            );
            return;
          }

          // Mermaid is by far the editor's largest optional dependency. It
          // is fetched only after a real diagram block exists, so ordinary
          // Markdown documents never pay its startup or parse cost.
          const mermaid = await loadMermaid();
          if (mySeq !== renderSeq) return;
          // The preview box's inner width: the column less its padding.
          const width = editorView.dom.clientWidth - 40;
          const fontFamily = getComputedStyle(editorView.dom).fontFamily;
          const style = `${appearanceIsDark()}|${fontFamily}`;
          configureMermaid(mermaid, width, fontFamily);
          const reusable =
            width === lastWidth && style === lastStyle
              ? lastRenders
              : new Map();

          const rendered = new Map<string, string>();
          for (const { code } of blocks) {
            if (!code.trim() || rendered.has(code)) continue; // identical diagrams share one render
            const cached = reusable.get(code);
            if (cached) {
              rendered.set(code, cached);
              continue;
            }
            try {
              const id = `mermaid-preview-${++renderIdCounter}`;
              const svg = await renderMermaid(mermaid, id, code);
              if (mySeq !== renderSeq) return; // superseded by a newer render pass
              rendered.set(code, svg);
            } catch {
              // invalid/incomplete diagram syntax mid-typing - just skip this block
            }
          }

          if (mySeq !== renderSeq) return;
          // Nothing new rendered and nothing dropped: the decorations
          // already show exactly this, so skip the rebuild.
          const unchanged =
            width === lastWidth &&
            style === lastStyle &&
            rendered.size === lastRenders.size &&
            [...rendered].every(([code, svg]) => lastRenders.get(code) === svg);
          if (width !== lastWidth || style !== lastStyle) renderGeneration++;
          lastRenders = rendered;
          lastWidth = width;
          lastStyle = style;
          if (unchanged) return;
          editorView.dispatch(
            editorView.state.tr.setMeta(mermaidKey, "rerender"),
          );
        }

        let waitingToBeShown = false;
        const shown =
          typeof ResizeObserver === "undefined"
            ? null
            : new ResizeObserver(() => {
                if (waitingToBeShown && editorView.dom.clientWidth > 0)
                  void renderAll();
              });
        shown?.observe(editorView.dom);
        // An appearance switch redraws the diagrams in the new colours.
        const restyle = () => {
          if (collectMermaidBlocks(editorView.state.doc).length > 0)
            void renderAll();
        };
        const appearance = new MutationObserver(restyle);
        appearance.observe(document.documentElement, {
          attributes: true,
          attributeFilter: [
            "data-theme",
            "data-content-theme",
            "data-light-page",
          ],
        });
        const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)");
        systemDark?.addEventListener("change", restyle);

        void renderAll();

        return {
          update(view, prevState) {
            if (view.state.doc.eq(prevState.doc)) return;
            // Large-doc mode (4.1): existing diagrams stay pinned (their
            // cached SVG is keyed by source text, untouched here) - only new
            // re-render passes, the expensive part, stop scheduling.
            if (isLargeDoc(view.state.doc)) return;
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(renderAll, DEBOUNCE_MS);
          },
          destroy() {
            if (debounceTimer) clearTimeout(debounceTimer);
            shown?.disconnect();
            appearance.disconnect();
            systemDark?.removeEventListener("change", restyle);
          },
        };
      },
    });
  });
}
