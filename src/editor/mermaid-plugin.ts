import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  applyReveal,
  revealAll,
  type Reveal,
  type RevealState,
  type Touches,
} from "./reveal-state";
import { fnv1a } from "../utils/hash";
import { zoomButton } from "./diagram-zoom";
import { isLargeDoc, pausesFeatures } from "./large-doc";
import { registerDrawAll } from "./draw-when-visible";
import { appearanceIsDark, diagramRenderer } from "./diagram-engine";
import {
  redrawPendingDiagrams,
  registerPendingDrawer,
} from "./pending-diagram";
import type { DiagramEngine } from "../settings/SettingsContext";

const mermaidKey = new PluginKey("mermaid-preview");
const DEBOUNCE_MS = 500;
/** Drawings of diagrams not in the document kept for when one is accepted;
 *  every streamed step of one lands here too. */
const PENDING_KEPT = 30;
// Render ids are unique across every editor: two tabs sharing an id removed
// each other's measuring node mid-render.
let renderIdCounter = 0;

/** A diagram as the preview last drew it. */
interface Drawn {
  svg: string;
  engine: DiagramEngine;
  /** What it was drawn for (the render pass's `styleOf`). */
  style: string;
  /** Part of its widget's key: with the source alone, ProseMirror kept the old
   *  widget DOM after a theme switch. */
  id: number;
}

interface MermaidBlock {
  from: number;
  to: number;
  code: string;
}

const isCodeBlock = (node: ProseNode) => node.type.name === "code_block";
const isMermaid = (node: ProseNode) =>
  isCodeBlock(node) && node.attrs.language === "mermaid";

function collectMermaidBlocks(doc: ProseNode): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  doc.descendants((node, pos) => {
    if (isMermaid(node)) {
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
 * A live diagram preview below every ```mermaid block. While the cursor is
 * away from a drawn block its source hides; moving back in, or clicking the
 * diagram, reveals it.
 */
export function createMermaidPreviewPlugin(options: {
  enabled: () => boolean;
  /** Which engine draws first. */
  engine: () => DiagramEngine;
}) {
  return $prose(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    // Per editor instance: rendering in one open tab must not cancel a
    // render already in flight in another tab.
    let renderSeq = 0;
    // Keyed by source text, not position: an edit above shifts every later
    // block's position, which would miss the cache and flash the source.
    let lastRenders = new Map<string, Drawn>();
    // What Textus AI's proposals drew, by source: an accepted diagram shows at
    // once, and the next pass takes the drawing over.
    const pendingDrawn = new Map<string, Drawn>();
    // The engine the last pass was started for: a change redraws every diagram.
    let drawnFor = options.engine();

    function decorate(
      node: ProseNode,
      from: number,
      touches: Touches,
    ): Decoration[] {
      if (!options.enabled() || !isMermaid(node)) return [];
      const code = node.textContent;
      const to = from + node.nodeSize;
      const drawn = lastRenders.get(code) ?? pendingDrawn.get(code);
      if (!drawn) return [];
      const { svg } = drawn;
      if (touches(from, to)) return [];
      return [
        Decoration.node(from, to, { class: "mermaid-source-hidden" }),
        Decoration.widget(
          to,
          (view: EditorView, getPos: () => number | undefined) => {
            const container = document.createElement("div");
            container.className = "mermaid-preview";
            container.innerHTML = svg;
            container.append(zoomButton(container));
            container.addEventListener("mousedown", (event) => {
              event.preventDefault();
              // The widget's DOM outlives edits above it, so where its block starts is
              // asked now.
              const end = getPos();
              if (end === undefined) return;
              const block = view.state.doc.resolve(end).nodeBefore;
              if (block?.type.name !== "code_block") return;
              const tr = view.state.tr.setSelection(
                TextSelection.create(view.state.doc, end - block.nodeSize + 1),
              );
              view.dispatch(tr);
              view.focus();
            });
            return container;
          },
          // ProseMirror reuses a widget's DOM while its key is unchanged, so the
          // source is part of the key; the position isn't, or typing above a diagram
          // rebuilt its SVG on every keystroke.
          {
            side: 1,
            key: `mermaid-${fnv1a(code).toString(36)}-${drawn.id}`,
          },
        ),
      ];
    }

    const reveal: Reveal = {
      match: isCodeBlock,
      decorate,
      config: options.enabled,
    };

    return new Plugin<RevealState>({
      key: mermaidKey,
      state: {
        init: (_config, state) => revealAll(state, reveal),
        apply(tr, prev, oldState, newState) {
          // A finished render has new SVG to show whatever the caret did.
          if (tr.getMeta(mermaidKey) === "rerender")
            return revealAll(newState, reveal);
          return applyReveal(tr, prev, oldState, newState, reveal);
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
          // A Pele drawing takes its colours from CSS variables, so an appearance
          // switch keeps it; a Mermaid one has its palette baked in.
          const layout = `${width}|${fontFamily}|${engine}`;
          const styleOf = (by: DiagramEngine) =>
            by === "pele" ? layout : `${layout}|${dark}`;
          // The editor's largest optional dependencies, fetched only when a real
          // diagram has to be drawn.
          const draw = diagramRenderer(engine, { width, fontFamily, dark });
          return { draw, styleOf };
        }

        // A proposal's diagram, drawn as the document's are.
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

        /** Whether the block at `pos` is within a screen of what the
         *  editor's scroller shows. */
        function nearView(pos: number): boolean {
          const scroller = editorView.dom.closest(".editor-scroll");
          const dom = editorView.nodeDOM(pos);
          if (!scroller || !(dom instanceof HTMLElement)) return true;
          const view = scroller.getBoundingClientRect();
          const box = dom.getBoundingClientRect();
          return (
            box.bottom >= view.top - view.height &&
            box.top <= view.bottom + view.height
          );
        }

        // In a large document, off-screen diagrams wait: a pass draws those near
        // the screen, scrolling the rest. `all` draws every one, for an export.
        let scroller: Element | null = null;
        let scrollTimer: ReturnType<typeof setTimeout> | undefined;
        const onScroll = () => {
          clearTimeout(scrollTimer);
          scrollTimer = setTimeout(() => void renderAll(), 100);
        };
        function waitForScroll(waiting: boolean) {
          const next = waiting
            ? editorView.dom.closest(".editor-scroll")
            : null;
          if (next === scroller) return;
          scroller?.removeEventListener("scroll", onScroll);
          next?.addEventListener("scroll", onScroll, { passive: true });
          scroller = next;
        }

        async function renderAll(all = false) {
          if (!options.enabled()) {
            lastRenders = new Map();
            editorView.dispatch(
              editorView.state.tr.setMeta(mermaidKey, "rerender"),
            );
            return;
          }

          // A background tab is display:none and can't be measured; render once shown.
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
          let offScreen = false;
          const large = isLargeDoc(editorView.state.doc);
          for (const { from, code } of blocks) {
            if (!code.trim() || rendered.has(code)) continue;
            // A pass only draws sources it hasn't drawn for the same width, face and
            // engine.
            const cached = lastRenders.get(code) ?? pendingDrawn.get(code);
            if (cached && cached.style === styleOf(cached.engine)) {
              rendered.set(code, cached);
              continue;
            }
            if (!all && large && !nearView(from)) {
              offScreen = true;
              continue;
            }
            try {
              const id = ++renderIdCounter;
              const { svg, engine: by } = await draw(
                code,
                `mermaid-preview-${id}`,
              );
              if (mySeq !== renderSeq) return;
              rendered.set(code, { svg, engine: by, style: styleOf(by), id });
            } catch {
              // Invalid or half-typed diagram syntax: skip this block.
            }
          }

          if (mySeq !== renderSeq) return;
          waitForScroll(offScreen);
          // Nothing new rendered and nothing dropped: skip the rebuild.
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
        registerDrawAll(editorView.dom, () => renderAll(true));

        return {
          update(view, prevState) {
            // The diagram engine setting changed: every diagram again, at once.
            if (options.engine() !== drawnFor) {
              drawnFor = options.engine();
              if (debounceTimer) clearTimeout(debounceTimer);
              redrawPendingDiagrams(view.dom);
              void renderAll();
              return;
            }
            if (view.state.doc.eq(prevState.doc)) return;
            // Past the pause threshold, existing diagrams stay as drawn; only new render
            // passes, the expensive part, stop.
            if (pausesFeatures(view.state.doc)) return;
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => void renderAll(), DEBOUNCE_MS);
          },
          destroy() {
            if (debounceTimer) clearTimeout(debounceTimer);
            clearTimeout(scrollTimer);
            waitForScroll(false);
            registerDrawAll(editorView.dom, null);
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
