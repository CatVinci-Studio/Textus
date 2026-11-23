import { onAppearance } from "../engine/tokens/appearance";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
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
import { pausesFeatures } from "./large-doc";
import { viewsWaitForScreen } from "./lazy/lazy-rules";
import { registerDrawAll, stopDrawing } from "./lazy/draw-when-visible";
import { appearanceIsDark } from "../engine/tokens/appearance";
import {
  diagramColours,
  diagramRenderer,
  mermaidTheme,
} from "./diagram-engine";
import { drawingFor, keepDrawing, lastDrawing } from "./drawn-diagrams";
import { holdStill } from "../engine/controls/scroll-hold";
import { stillPoint } from "./lazy/still-point";
import {
  collectMermaidBlocks,
  drawingKey,
  isCodeBlock,
  isMermaid,
  type Drawn,
} from "./mermaid-blocks";
import { diagramErrorWidget, diagramWidget } from "./mermaid-widget";
import {
  redrawPendingDiagrams,
  registerPendingDrawer,
} from "./pending-diagram";
import type { DiagramEngine } from "../prefs/SettingsContext";

const mermaidKey = new PluginKey("mermaid-preview");
const DEBOUNCE_MS = 500;
/** How far the column's width must move before drawings are laid out again,
 *  and how long it must then hold still: a panel sliding open redraws once. */
const RESIZE_REDRAW_PX = 24;
const RESIZE_DEBOUNCE_MS = 250;
/** The longest a pass waits while the text keeps changing: a paper being
 *  written changes several times a second, and its diagrams were drawn only
 *  once it stopped. */
const MAX_WAIT_MS = 2000;
/** Drawings of diagrams not in the document kept for when one is accepted;
 *  every streamed step of one lands here too. */
const PENDING_KEPT = 30;
// Render ids are unique across every editor: two tabs sharing an id removed
// each other's measuring node mid-render.
let renderIdCounter = 0;

/**
 * A live diagram preview below every ```mermaid and ```chart block. While
 * the cursor is away from a drawn block its source hides; moving back in, or
 * clicking the diagram, reveals it.
 */
export function createMermaidPreviewPlugin(options: {
  enabled: () => boolean;
  /** Which engine draws first. */
  engine: () => DiagramEngine;
  /** The document's path, which a folded diagram is kept under. */
  path: () => string | null;
}) {
  return $prose(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    /** When the edits the next pass waits for began; 0 when none wait. */
    let waitingSince = 0;
    // Per editor instance: rendering in one open tab must not cancel a
    // render already in flight in another tab.
    let renderSeq = 0;
    // Keyed by source text, not position: an edit above shifts every later
    // block's position, which would miss the cache and flash the source.
    let lastRenders = new Map<string, Drawn>();
    // Why each source that couldn't be drawn wasn't, shown under it (#775).
    let failures = new Map<string, string>();
    // What Textus AI's proposals drew, by source: an accepted diagram shows at
    // once, and the next pass takes the drawing over.
    const pendingDrawn = new Map<string, Drawn>();
    // The engine the last pass was started for: a change redraws every diagram.
    let drawnFor = options.engine();
    /** The width the last pass laid drawings out at. */
    let drawnWidth = 0;

    function decorate(
      node: ProseNode,
      from: number,
      touches: Touches,
    ): Decoration[] {
      if (!options.enabled() || !isMermaid(node)) return [];
      const code = drawingKey(node.attrs.language, node.textContent);
      const to = from + node.nodeSize;
      const failed = failures.get(code);
      // A tab made again shows the last drawing until its first pass.
      const drawn =
        lastRenders.get(code) ??
        pendingDrawn.get(code) ??
        (failed === undefined ? lastDrawing(code) : undefined);
      if (!drawn) return failureNote(code, to, failed);
      const { svg } = drawn;
      if (touches(from, to)) return [];
      return [
        Decoration.node(from, to, { class: "mermaid-source-hidden" }),
        Decoration.widget(
          to,
          (view: EditorView, getPos: () => number | undefined) =>
            diagramWidget(view, getPos, svg, {
              fold: `${options.path() ?? ""}\ndiagram:${fnv1a(code).toString(36)}`,
            }),
          // ProseMirror reuses a widget's DOM while its key is unchanged, so the
          // source is part of the key; the position isn't, or typing above a diagram
          // rebuilt its SVG on every keystroke.
          {
            side: 1,
            key: `mermaid-${fnv1a(code).toString(36)}-${drawn.id}`,
            // The drawing's box is what is watched (diagramWidget).
            destroy: (dom) =>
              stopDrawing(
                (dom as Element).querySelector?.(".mermaid-preview") ?? dom,
              ),
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
          drawnWidth = width;
          const fontFamily = getComputedStyle(editorView.dom).fontFamily;
          const engine = options.engine();
          const dark = appearanceIsDark();
          // A Pele drawing takes its colours from CSS variables, so an appearance
          // switch keeps it; a Mermaid one has its palette baked in. The theme
          // name is in the key too, so switching an imported theme that sets
          // --doc-mermaid-theme redraws Mermaid's diagrams in its palette.
          const layout = `${width}|${fontFamily}|${engine}`;
          const mermaidStyle = `${layout}|${dark}|${mermaidTheme(dark)}`;
          const styleOf = (by: Drawn["engine"]) =>
            by === "pele" ? layout : mermaidStyle;
          // The editor's largest optional dependencies, fetched only when a real
          // diagram has to be drawn.
          const draw = diagramRenderer(engine, { width, fontFamily, dark });
          const styles = [layout, mermaidStyle];
          return { draw, styleOf, styles };
        }

        // A proposal's diagram, drawn as the document's are.
        registerPendingDrawer(editorView.dom, async (code, language) => {
          if (!options.enabled() || editorView.dom.clientWidth === 0)
            throw new Error("diagrams are not drawn here");
          const { draw, styleOf } = drawing();
          const key = drawingKey(language, code);
          let drawn = pendingDrawn.get(key) ?? lastRenders.get(key);
          if (!drawn || drawn.style !== styleOf(drawn.engine)) {
            const id = ++renderIdCounter;
            const { svg, engine: by } = await draw(
              code,
              `mermaid-preview-${id}`,
              language,
            );
            drawn = { svg, engine: by, style: styleOf(by), id };
          }
          pendingDrawn.delete(key);
          pendingDrawn.set(key, drawn);
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

        // The new drawings with what the reader sees held where it is. A
        // diagram's source that hides has no place after: its drawing,
        // where the source began, is held instead.
        function redraw() {
          const scroller = editorView.dom.closest(".editor-scroll");
          const still = scroller && stillPoint(editorView.dom, scroller);
          editorView.dispatch(
            editorView.state.tr.setMeta(mermaidKey, "rerender"),
          );
          let el = still?.el ?? null;
          while (el && !el.getClientRects().length) el = el.nextElementSibling;
          if (scroller && still && el) holdStill(scroller, { ...still, el });
        }

        async function renderAll(all = false) {
          if (!options.enabled()) {
            // Nothing drawn before: nothing to take back.
            if (lastRenders.size === 0 && failures.size === 0) return;
            lastRenders = new Map();
            failures = new Map();
            redraw();
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
            if (lastRenders.size === 0 && failures.size === 0) return;
            lastRenders = new Map();
            failures = new Map();
            redraw();
            return;
          }

          const { draw, styleOf, styles } = drawing();

          const rendered = new Map<string, Drawn>();
          const failed = new Map<string, string>();
          let offScreen = false;
          const large = viewsWaitForScreen(editorView.state.doc);
          for (const { from, code, language, key } of blocks) {
            if (!code.trim() || rendered.has(key) || failed.has(key)) continue;
            // A pass only draws sources it hasn't drawn for the same width, face and
            // engine.
            const own = lastRenders.get(key) ?? pendingDrawn.get(key);
            const cached =
              own && own.style === styleOf(own.engine)
                ? own
                : drawingFor(key, styles);
            if (cached) {
              rendered.set(key, cached);
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
                language,
              );
              const drawn = { svg, engine: by, style: styleOf(by), id };
              keepDrawing(key, drawn);
              if (mySeq !== renderSeq) return;
              rendered.set(key, drawn);
            } catch (error) {
              // Invalid or half-typed: its source stays, with why under it.
              if (mySeq !== renderSeq) return;
              failed.set(key, whyNotDrawn(error));
            }
          }

          if (mySeq !== renderSeq) return;
          waitForScroll(offScreen);
          // Nothing new rendered and nothing dropped: skip the rebuild.
          const unchanged =
            rendered.size === lastRenders.size &&
            [...rendered].every(
              ([code, drawn]) => lastRenders.get(code) === drawn,
            ) &&
            failed.size === failures.size &&
            [...failed].every(([code, why]) => failures.get(code) === why);
          lastRenders = rendered;
          failures = failed;
          if (unchanged) return;
          redraw();
        }

        let waitingToBeShown = false;
        // A wider or narrower column lays every drawing out again, once it
        // has settled: a chart drawn while the column was narrow would
        // otherwise stay that small.
        let resizeTimer: ReturnType<typeof setTimeout> | undefined;
        const shown =
          typeof ResizeObserver === "undefined"
            ? null
            : new ResizeObserver(() => {
                const width = editorView.dom.clientWidth;
                if (waitingToBeShown && width > 0) {
                  void renderAll();
                  return;
                }
                if (
                  width === 0 ||
                  Math.abs(width - 40 - drawnWidth) < RESIZE_REDRAW_PX
                )
                  return;
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => {
                  if (collectMermaidBlocks(editorView.state.doc).length > 0)
                    void renderAll();
                }, RESIZE_DEBOUNCE_MS);
              });
        shown?.observe(editorView.dom);
        // An appearance switch redraws the diagrams in the new colours.
        const restyle = () => {
          redrawPendingDiagrams(editorView.dom);
          if (collectMermaidBlocks(editorView.state.doc).length > 0)
            void renderAll();
        };
        // Only a change of colours: every diagram is drawn again.
        let drawnIn = diagramColours();
        const stopAppearance = onAppearance(() => {
          const now = diagramColours();
          if (now === drawnIn) return;
          drawnIn = now;
          restyle();
        });

        // The first pass waits for the observer's first call, made once the
        // browser has laid the new editor out: asking its width now would
        // lay the whole document out in the middle of opening it.
        if (shown) waitingToBeShown = true;
        else void renderAll();
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
            if (view.state.doc === prevState.doc) return;
            // Past the pause threshold, existing diagrams stay as drawn; only new render
            // passes, the expensive part, stop.
            if (pausesFeatures(view.state.doc)) return;
            if (debounceTimer) clearTimeout(debounceTimer);
            const now = Date.now();
            waitingSince ||= now;
            debounceTimer = setTimeout(
              () => {
                waitingSince = 0;
                void renderAll();
              },
              Math.max(
                0,
                Math.min(DEBOUNCE_MS, waitingSince + MAX_WAIT_MS - now),
              ),
            );
          },
          destroy() {
            if (debounceTimer) clearTimeout(debounceTimer);
            clearTimeout(scrollTimer);
            clearTimeout(resizeTimer);
            waitForScroll(false);
            registerDrawAll(editorView.dom, null);
            registerPendingDrawer(editorView.dom, null);
            shown?.disconnect();
            stopAppearance();
          },
        };
      },
    });
  });
}

/** The note under a diagram that couldn't be drawn (`why`: undefined when
 *  it didn't fail); a renderer that said nothing still gets its title. */
export function failureNote(
  code: string,
  to: number,
  why: string | undefined,
): Decoration[] {
  if (why === undefined) return [];
  return [
    Decoration.widget(to, () => diagramErrorWidget(why), {
      side: 1,
      key: `mermaid-error-${fnv1a(code).toString(36)}-${fnv1a(why).toString(36)}`,
      ignoreSelection: true,
    }),
  ];
}

/** What a renderer threw, as a few lines a person can act on: Mermaid's
 *  "Parse error on line 3: ... Expecting ..., got ...". */
export function whyNotDrawn(error: unknown): string {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const lines = text.trim().split("\n").slice(0, 6).join("\n");
  return lines.length > 600 ? `${lines.slice(0, 600)}…` : lines;
}
