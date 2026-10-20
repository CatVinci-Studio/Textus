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
import { appearanceIsDark, diagramRenderer } from "./diagram-engine";
import {
  redrawPendingDiagrams,
  registerPendingDrawer,
} from "./pending-diagram";
import type { DiagramEngine } from "../settings/SettingsContext";

const mermaidKey = new PluginKey("mermaid-preview");
const DEBOUNCE_MS = 500;
/** Drawings of diagrams not in the document (pending-diagram.ts) kept for
 *  when one is accepted - every streamed step of one lands here too. */
const PENDING_KEPT = 30;
// Render ids are unique across every editor, not per editor: two tabs
// rendering at startup both used "mermaid-preview-1-0", and the first one
// to finish removed the other's measuring node mid-render (renderMermaid's
// cleanup), so the diagram in the other tab failed and stayed raw source.
let renderIdCounter = 0;

// Cheap stable hash of a diagram's source, for the widget key below.
function hashCode(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** A diagram as the preview last drew it. */
interface Drawn {
  svg: string;
  engine: DiagramEngine;
  /** What it was drawn for (the render pass's `styleOf`). */
  style: string;
  /** Part of its widget's key: with the source alone as the key,
   *  ProseMirror kept the old widget DOM, so a switch to dark redrew the
   *  diagrams and still showed the light ones. */
  id: number;
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
  /** Settings.diagramEngine: which engine draws first (diagram-engine.ts). */
  engine: () => DiagramEngine;
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
    let lastRenders = new Map<string, Drawn>();
    // What Textus AI's proposals drew (pending-diagram.ts), by source: an
    // accepted diagram shows at once instead of as source until the next
    // pass, which takes the drawing over instead of drawing it again.
    const pendingDrawn = new Map<string, Drawn>();
    // The engine the last pass was started for: a change in Settings draws
    // every diagram again (view.update below).
    let drawnFor = options.engine();

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
        const drawn = lastRenders.get(code) ?? pendingDrawn.get(code);
        if (!drawn) continue;
        const { svg } = drawn;
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
              key: `mermaid-${hashCode(code)}-${nth}-${drawn.id}`,
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
        /** How a pass draws now, and what a drawing then depends on. */
        function drawing() {
          // The preview box's inner width: the column less its padding.
          const width = editorView.dom.clientWidth - 40;
          const fontFamily = getComputedStyle(editorView.dom).fontFamily;
          const engine = options.engine();
          const dark = appearanceIsDark();
          // What a drawing depends on. A Pele one takes its colours from CSS
          // variables (milkdown-theme.css), so a switch of appearance keeps
          // it; a Mermaid one has its palette baked in and is drawn again.
          const layout = `${width}|${fontFamily}|${engine}`;
          const styleOf = (by: DiagramEngine) =>
            by === "pele" ? layout : `${layout}|${dark}`;
          // Mermaid and Pele are the editor's largest optional dependencies.
          // One is fetched only when a real diagram has to be drawn, so
          // ordinary Markdown documents never pay for either.
          const draw = diagramRenderer(engine, { width, fontFamily, dark });
          return { draw, styleOf };
        }

        // A proposal's diagram (pending-diagram.ts), drawn as the
        // document's are.
        registerPendingDrawer(editorView.dom, async (code) => {
          if (!options.enabled() || editorView.dom.clientWidth === 0)
            throw new Error("diagrams are not drawn here");
          const { draw, styleOf } = drawing();
          let drawn = pendingDrawn.get(code) ?? lastRenders.get(code);
          if (!drawn || drawn.style !== styleOf(drawn.engine)) {
            const id = ++renderIdCounter;
            const { svg, engine: by } = await draw(
              code,
              `mermaid-preview-${id}`,
            );
            drawn = { svg, engine: by, style: styleOf(by), id };
          }
          pendingDrawn.delete(code);
          pendingDrawn.set(code, drawn);
          if (pendingDrawn.size > PENDING_KEPT)
            pendingDrawn.delete(pendingDrawn.keys().next().value as string);
          return { svg: drawn.svg, idPrefix: `mermaid-preview-${drawn.id}` };
        });

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

          const { draw, styleOf } = drawing();

          const rendered = new Map<string, Drawn>();
          for (const { code } of blocks) {
            if (!code.trim() || rendered.has(code)) continue; // identical diagrams share one render
            // Drawn for the same width, face and engine: a pass only draws
            // sources it hasn't seen, instead of every diagram again 500ms
            // after each keystroke anywhere in the document.
            const cached = lastRenders.get(code) ?? pendingDrawn.get(code);
            if (cached && cached.style === styleOf(cached.engine)) {
              rendered.set(code, cached);
              continue;
            }
            try {
              const id = ++renderIdCounter;
              const { svg, engine: by } = await draw(
                code,
                `mermaid-preview-${id}`,
              );
              if (mySeq !== renderSeq) return; // superseded by a newer render pass
              rendered.set(code, { svg, engine: by, style: styleOf(by), id });
            } catch {
              // invalid/incomplete diagram syntax mid-typing - just skip this block
            }
          }

          if (mySeq !== renderSeq) return;
          // Nothing new rendered and nothing dropped: the decorations
          // already show exactly this, so skip the rebuild.
          const unchanged =
            rendered.size === lastRenders.size &&
            [...rendered].every(
              ([code, drawn]) => lastRenders.get(code) === drawn,
            );
          lastRenders = rendered;
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
          redrawPendingDiagrams(editorView.dom);
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
            // Settings › Diagram engine changed (MilkdownEditor dispatches a
            // transaction for it): every diagram again, at once.
            if (options.engine() !== drawnFor) {
              drawnFor = options.engine();
              if (debounceTimer) clearTimeout(debounceTimer);
              redrawPendingDiagrams(view.dom);
              void renderAll();
              return;
            }
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
            registerPendingDrawer(editorView.dom, null);
            shown?.disconnect();
            appearance.disconnect();
            systemDark?.removeEventListener("change", restyle);
          },
        };
      },
    });
  });
}
