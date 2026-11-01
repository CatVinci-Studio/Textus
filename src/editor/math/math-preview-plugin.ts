import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { duration, motionAllowed } from "../../ui/motion";
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

const mathPreviewKey = new PluginKey("math-preview");
const KATEX_READY = "katex-ready";

// A formula is redrawn whenever the caret enters or leaves it, and KaTeX is
// the expensive part; renders are pure in (source, mode), so they're cached.
const RENDER_CACHE_LIMIT = 1000;
const renderCache = new Map<string, string>();

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
    html = value;
  }
  if (renderCache.size >= RENDER_CACHE_LIMIT) renderCache.clear();
  renderCache.set(cacheKey, html);
  return html;
}

// Empty room under a block formula for the floating preview to sit over, so
// it doesn't cover the next paragraph. An inline formula gets none: room
// would make the lines below jump as the caret passes.
const ROOM = "math-preview-room";
function blockRoom(): HTMLElement {
  const el = document.createElement("div");
  el.className = ROOM;
  return el;
}

const isMath = (node: ProseNode) =>
  node.type.name === "math_inline" || node.type.name === "math_block";

function decorateMath(
  node: ProseNode,
  pos: number,
  touches: Touches,
): Decoration[] {
  const from = pos;
  const to = pos + node.nodeSize;
  // While the cursor touches the node, enclosure reveals the source; the
  // KaTeX swap stays out of the way for exactly that range.
  if (touches(from, to)) {
    // A block's preview room: there whenever the source is revealed, because
    // this set is only redrawn when cursorTouches flips.
    return node.type.name === "math_block"
      ? [
          Decoration.widget(to, blockRoom, {
            side: 1,
            key: "math-room",
            ignoreSelection: true,
          }),
        ]
      : [];
  }

  // KaTeX still loading: the source stays in view until it is drawn.
  if (!katexNow()) return [];
  const displayMode = node.type.name === "math_block";
  const source = node.textContent;
  return [
    Decoration.inline(from + 1, to - 1, { class: "math-source-hidden" }),
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
  const { selection } = state;
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
 * formula's source hides behind its KaTeX render; while inside, a floating
 * live preview follows below the cursor.
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
          const floatEl = document.createElement("div");
          floatEl.className = "math-float-preview";
          floatEl.style.display = "none";
          document.body.appendChild(floatEl);

          // The preview shows on a short delay and hides at once: the selection can
          // pass through a math node for one update (WKWebView normalization, fast
          // arrowing), which flashed the box. Once visible, updates stay synchronous.
          let showTimer: number | null = null;
          const cancelShow = () => {
            if (showTimer !== null) {
              window.clearTimeout(showTimer);
              showTimer = null;
            }
          };
          // Hiding plays the box's short exit first; coming back mid-exit cancels it.
          let hideTimer: number | null = null;
          const cancelHide = () => {
            if (hideTimer !== null) {
              window.clearTimeout(hideTimer);
              hideTimer = null;
            }
            delete floatEl.dataset.state;
          };
          // The room closes with the box, so the text doesn't slide back under a box
          // still fading out.
          const closeRooms = (keep?: HTMLElement) => {
            editorView.dom
              .querySelectorAll<HTMLElement>(`.${ROOM}`)
              .forEach((el) => {
                if (el === keep) return;
                el.style.display = "";
                el.style.height = "";
              });
          };
          const hide = () => {
            cancelShow();
            if (floatEl.style.display === "none" || hideTimer !== null) return;
            if (!motionAllowed()) {
              floatEl.style.display = "none";
              closeRooms();
              return;
            }
            floatEl.dataset.state = "closing";
            hideTimer = window.setTimeout(() => {
              hideTimer = null;
              delete floatEl.dataset.state;
              floatEl.style.display = "none";
              closeRooms();
            }, duration("--dur-fast"));
          };

          function updateFloat(view: EditorView, fromTimer = false) {
            if (!options.enabled()) {
              hide();
              return;
            }
            const found = findMathNodeAtSelection(view.state);
            // Nothing to preview until there's source: an empty shell would show a bare
            // box.
            if (!found || !found.node.textContent.trim()) {
              hide();
              return;
            }
            cancelHide();
            if (floatEl.style.display === "none" && !fromTimer) {
              if (showTimer === null) {
                showTimer = window.setTimeout(() => {
                  showTimer = null;
                  updateFloat(view, true);
                }, 150);
              }
              return;
            }

            const displayMode = found.node.type.name === "math_block";
            floatEl.innerHTML =
              renderKatex(found.node.textContent, displayMode) ??
              mathSourceHtml(found.node.textContent);
            floatEl.style.display = "block";
            // Brought into view as it opens and grows; a scroll or column move only
            // re-places it, or it would fight the user's scrolling.
            place(view, true);
          }

          /** The room widget after the block formula at `from`. */
          function roomOf(view: EditorView, from: number): HTMLElement | null {
            let el = view.nodeDOM(from)?.nextSibling ?? null;
            for (let i = 0; el && i < 3; i++, el = el.nextSibling) {
              if (el instanceof HTMLElement && el.classList.contains(ROOM))
                return el;
            }
            return null;
          }

          function place(view: EditorView, reveal = false) {
            const found = findMathNodeAtSelection(view.state);
            if (!found) return;
            const block = found.node.type.name === "math_block";
            const end = found.from + found.node.nodeSize - 1;
            // Below the formula, as other popups appear: under a block's panel,
            // centred; under an inline formula's line, starting at the caret.
            // offsetWidth/Height, not the rect: the pop-in plays as a scale.
            const width = floatEl.offsetWidth;
            const height = floatEl.offsetHeight;
            const caret = view.coordsAtPos(view.state.selection.from);
            const panel = block
              ? (view.nodeDOM(found.from) as HTMLElement | null)
              : null;
            const panelBox = panel?.getBoundingClientRect();
            let top: number;
            let left: number;
            if (panelBox) {
              top = panelBox.bottom + 10;
              left = panelBox.left + (panelBox.width - width) / 2;
            } else {
              top = view.coordsAtPos(end, -1).bottom + 10;
              left = caret.left;
            }
            left = Math.max(8, Math.min(left, window.innerWidth - width - 8));

            // A block's room, sized from its own top and in layout px: the column is
            // zoomed with CSS zoom, the box in <body> is not.
            const room = roomOf(view, found.from);
            closeRooms(room ?? undefined);
            if (room) {
              room.style.display = "flow-root";
              const roomTop = room.getBoundingClientRect().top;
              const host = room.parentElement!;
              const scale =
                host.getBoundingClientRect().width /
                Math.max(1, host.offsetWidth);
              const need = Math.max(0, top + height + 6 - roomTop) / scale;
              room.style.height = `${Math.ceil(need)}px`;
              if (reveal) room.scrollIntoView({ block: "nearest" });
              // Scrolling (or the room itself) moved the formula.
              if (panel) top = panel.getBoundingClientRect().bottom + 10;
              else top = view.coordsAtPos(end, -1).bottom + 10;
            }

            // Flipped above only when even the room is cut off.
            const above = top + height > window.innerHeight - 8;
            if (above) {
              const lineTop = panel
                ? panel.getBoundingClientRect().top
                : view.coordsAtPos(view.state.selection.from).top;
              top = Math.max(8, lineTop - height - 10);
            }
            floatEl.style.left = `${left}px`;
            floatEl.style.top = `${top}px`;
            // It grows out of the corner nearest the caret.
            floatEl.style.setProperty(
              "--transform-origin",
              `${above ? "bottom" : "top"} ${block ? "center" : "left"}`,
            );
          }

          updateFloat(editorView);

          // The page can move under an open preview without a transaction (the AI
          // panel narrowing the column, a scroll); it follows the caret.
          let frame = 0;
          let settleTimer: number | undefined;
          const placeIfShown = () => {
            if (floatEl.style.display !== "none") place(editorView);
          };
          const follow = () => {
            if (floatEl.style.display === "none" || hideTimer !== null) return;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(placeIfShown);
            // Once more after the column's glide to its new place has ended.
            window.clearTimeout(settleTimer);
            settleTimer = window.setTimeout(placeIfShown, 400);
          };
          const resize =
            typeof ResizeObserver === "undefined"
              ? null
              : new ResizeObserver(follow);
          resize?.observe(editorView.dom);
          // The pane too: a column that keeps its width still moves when the pane
          // beside it narrows.
          const pane = editorView.dom.closest(".editor-scroll");
          if (pane) resize?.observe(pane);
          window.addEventListener("resize", follow);
          document.addEventListener("scroll", follow, true);

          return {
            // Wrapped: the update callback's second argument would land in fromTimer.
            update: (view) => updateFloat(view),
            destroy() {
              stopWaiting();
              cancelShow();
              cancelHide();
              cancelAnimationFrame(frame);
              window.clearTimeout(settleTimer);
              resize?.disconnect();
              window.removeEventListener("resize", follow);
              document.removeEventListener("scroll", follow, true);
              floatEl.remove();
            },
          };
        },
      }),
  );
}
