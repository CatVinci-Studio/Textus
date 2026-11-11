import { onMemoryIdle } from "../../utils/memory-idle";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  applyReveal,
  caretToSourceOnClick,
  revealAll,
  type Reveal,
  type RevealState,
  type Touches,
} from "../reveal-state";
import { drawWhenVisible } from "../draw-when-visible";
import { isLargeDoc } from "../large-doc";
import { katexNow, mathSourceHtml, onKatexReady } from "./katex-loader";
import { renderFormula } from "./matrix-rows";
import { revealSelection } from "../pointer-hold";

const mathPreviewKey = new PluginKey("math-preview");
const KATEX_READY = "katex-ready";

// A formula is redrawn whenever the caret enters or leaves it, and KaTeX is
// the expensive part; renders are pure in (source, mode), so they're cached.
const RENDER_CACHE_LIMIT = 1000;
const renderCache = new Map<string, string>();
onMemoryIdle(() => renderCache.clear());

const cacheKeyOf = (value: string, displayMode: boolean) =>
  `${displayMode ? "B" : "I"}${value}`;

/** The formula drawn, or null until KaTeX has loaded. */
function renderKatex(value: string, displayMode: boolean): string | null {
  const cacheKey = cacheKeyOf(value, displayMode);
  const cached = renderCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const katex = katexNow();
  if (!katex) return null;
  let html: string;
  try {
    html = renderFormula(katex, value || "\\,", {
      throwOnError: false,
      displayMode,
    });
  } catch {
    // Shown as its source, escaped; tried again next time.
    return mathSourceHtml(value);
  }
  if (renderCache.size >= RENDER_CACHE_LIMIT) renderCache.clear();
  renderCache.set(cacheKey, html);
  return html;
}

/** Where a formula's live preview shows while its source is edited: in
 *  the document, under the formula - in the flow under a block, hanging
 *  below the line from an inline one - so it scrolls, moves and hides with
 *  its document. Filled by the plugin's view as the source changes. */
const PREVIEW = "math-float-preview";
function previewBox(block: boolean): HTMLElement {
  const holder = document.createElement(block ? "div" : "span");
  holder.className = block ? "math-preview-room" : "math-preview-anchor";
  const box = document.createElement(block ? "div" : "span");
  box.className = PREVIEW;
  box.setAttribute("aria-hidden", "true");
  box.hidden = true;
  holder.append(box);
  return holder;
}

/** GitHub's ```math fence, drawn as a display formula. */
const isMathFence = (node: ProseNode) =>
  node.type.name === "code_block" &&
  String(node.attrs.language).toLowerCase() === "math";

const isMath = (node: ProseNode) =>
  node.type.name === "math_inline" ||
  node.type.name === "math_block" ||
  isMathFence(node);

function decorateMath(
  node: ProseNode,
  pos: number,
  touches: Touches,
): Decoration[] {
  const from = pos;
  const to = pos + node.nodeSize;
  // While the cursor touches the node, enclosure reveals the source; the
  // KaTeX swap stays out of the way for exactly that range.
  const fence = isMathFence(node);
  if (touches(from, to)) {
    if (fence) return [];
    // The preview's place: there whenever the source is revealed, because
    // this set is only redrawn when cursorTouches flips.
    const block = node.type.name === "math_block";
    // Under a block; from an inline formula's start, as its line reads.
    return [
      Decoration.widget(block ? to : from, () => previewBox(block), {
        side: block ? 1 : -1,
        key: block ? "math-preview-block" : "math-preview-inline",
        ignoreSelection: true,
      }),
    ];
  }

  // KaTeX still loading: the source stays in view until it is drawn.
  if (!katexNow()) return [];
  const displayMode = fence || node.type.name === "math_block";
  const source = node.textContent;
  return [
    fence
      ? Decoration.node(from, to, { class: "math-fence-hidden" })
      : Decoration.inline(from + 1, to - 1, { class: "math-source-hidden" }),
    Decoration.widget(
      to,
      (view: EditorView, getPos: () => number | undefined) => {
        const el = document.createElement(displayMode ? "div" : "span");
        el.className = displayMode
          ? "math-block-rendered"
          : "math-inline-rendered";
        const draw = () => {
          el.innerHTML =
            renderKatex(source, displayMode) ?? mathSourceHtml(source);
        };
        // In a large document, one not drawn before waits until it nears the
        // screen, its source standing in.
        if (
          renderCache.has(cacheKeyOf(source, displayMode)) ||
          !isLargeDoc(view.state.doc)
        )
          draw();
        else {
          el.innerHTML = mathSourceHtml(source);
          drawWhenVisible(el, view.dom, draw);
        }
        caretToSourceOnClick(el, view, getPos);
        return el;
      },
      // Keyed by the source, so the rendered element survives transactions and is
      // replaced only when the source changes.
      {
        side: -1,
        key: `math:${displayMode ? "B" : "I"}:${node.textContent}`,
      },
    ),
  ];
}

function mathReveal(enabled: () => boolean): Reveal {
  return {
    match: isMath,
    decorate: (node, pos, touches) =>
      enabled() ? decorateMath(node, pos, touches) : [],
    config: enabled,
  };
}

function findMathNodeAtSelection(state: EditorState): {
  node: { type: { name: string }; textContent: string; nodeSize: number };
  from: number;
} | null {
  // The reveal's selection, so the preview opens only over a source shown.
  const selection = revealSelection(state);
  let found: {
    node: { type: { name: string }; textContent: string; nodeSize: number };
    from: number;
  } | null = null;
  // Only nodes the selection lies in can contain it.
  state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (found) return false;
    if (node.type.name !== "math_inline" && node.type.name !== "math_block")
      return;
    // Content bounds, not the node's: the preview follows only while editing
    // the source, not while merely adjacent.
    const from = pos + 1;
    const to = pos + node.nodeSize - 1;
    if (selection.from >= from && selection.to <= to) {
      found = { node, from: pos };
    }
  });
  return found;
}

/**
 * Math extras on the shared enclosure model: while the cursor is away a
 * formula's source hides behind its KaTeX render; while inside, a live
 * preview shows under it, in the document.
 */
export function createMathPreviewPlugin(options: { enabled: () => boolean }) {
  const reveal = mathReveal(options.enabled);
  return $prose(
    () =>
      new Plugin<RevealState>({
        key: mathPreviewKey,
        state: {
          init: (_config, state) => revealAll(state, reveal),
          apply: (tr, prev, oldState, newState) =>
            // KaTeX has loaded: every formula left as source is drawn now.
            tr.getMeta(mathPreviewKey) === KATEX_READY
              ? revealAll(newState, reveal)
              : applyReveal(tr, prev, oldState, newState, reveal),
        },
        props: {
          decorations(state) {
            return mathPreviewKey.getState(state)?.set;
          },
        },
        view(editorView) {
          const stopWaiting = onKatexReady(() => {
            if (editorView.isDestroyed) return;
            editorView.dispatch(
              editorView.state.tr
                .setMeta(mathPreviewKey, KATEX_READY)
                .setMeta("addToHistory", false),
            );
          });
          /** The preview box beside the formula at `from` (before an
           *  inline one, after a block), if revealed. */
          const boxOf = (view: EditorView, from: number) => {
            const formula = view.nodeDOM(from);
            for (const side of ["previousSibling", "nextSibling"] as const) {
              let el = formula?.[side] ?? null;
              for (let i = 0; el && i < 3; i++, el = el[side]) {
                const box =
                  el instanceof HTMLElement ? el.firstElementChild : null;
                if (
                  box instanceof HTMLElement &&
                  box.classList.contains(PREVIEW)
                )
                  return box;
              }
            }
            return null;
          };

          function updatePreview(view: EditorView) {
            const found = findMathNodeAtSelection(view.state);
            const box = found ? boxOf(view, found.from) : null;
            // Only the formula being edited shows one: a revealed one the
            // caret only touches, or left, shows none.
            for (const other of view.dom.querySelectorAll<HTMLElement>(
              `.${PREVIEW}:not([hidden])`,
            ))
              if (other !== box) other.hidden = true;
            if (!found || !box) return;
            const source = found.node.textContent;
            // Nothing to preview until there's source: an empty box would
            // show bare.
            box.hidden = !options.enabled() || !source.trim();
            const displayMode = found.node.type.name === "math_block";
            const drawn = renderKatex(source, displayMode);
            const key = `${drawn === null ? "?" : ""}${source}`;
            if (box.dataset.source === key) return;
            box.dataset.source = key;
            box.innerHTML = drawn ?? mathSourceHtml(source);
          }

          updatePreview(editorView);

          return {
            update: (view) => updatePreview(view),
            destroy: stopWaiting,
          };
        },
      }),
  );
}
