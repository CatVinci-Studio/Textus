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

const mathPreviewKey = new PluginKey("math-preview");
const KATEX_READY = "katex-ready";

// A formula is drawn again whenever the caret enters or leaves it, or the
// block holding it is edited, and KaTeX is the expensive part. Renders are
// pure in (source, mode), so they are cached; the cap only bounds a
// session that types through thousands of formulas. A formula first drawn
// waits until it is near the screen (draw-when-visible.ts).
const RENDER_CACHE_LIMIT = 1000;
const renderCache = new Map<string, string>();

const cacheKeyOf = (value: string, displayMode: boolean) =>
  `${displayMode ? "B" : "I"}${value}`;

/** The formula drawn, or null until KaTeX has loaded (katex-loader.ts). */
function renderKatex(value: string, displayMode: boolean): string | null {
  const cacheKey = cacheKeyOf(value, displayMode);
  const cached = renderCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const katex = katexNow();
  if (!katex) return null;
  let html: string;
  try {
    html = katex.renderToString(value || "\\,", {
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

// Empty room in the document under a block formula, which the floating
// preview sits over so it doesn't cover the paragraph after it. Hung below
// the panel on its own, it landed on that paragraph once the column was
// narrow enough for its first line to run under it. display: none until the
// preview shows; place() sizes it. A block between the panel and the next
// paragraph. An inline formula gets none: its preview is brief, and room
// for it would make the lines below jump each time the caret passes
// through - it floats over the text instead, as it always has.
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
  // While the cursor touches the node (inside or adjacent), enclosure.ts
  // reveals the raw source with its synthesized $ / $$ delimiters - the
  // KaTeX swap below must stay out of the way for exactly that range, so
  // both sides share the same predicate.
  if (touches(from, to)) {
    // A block's live preview room (see place()): there whenever the
    // source is revealed, not only while the caret is inside it, because
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
        // In a large document, one not drawn before waits until it comes
        // near the screen, its source standing in, about as wide.
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
      // Keyed by the source, so ProseMirror keeps the rendered element
      // across transactions instead of rebuilding every formula's DOM on
      // every keystroke - and still replaces it when the source changes.
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
    // Content bounds, not the node's outer bounds - the floating preview
    // should only follow while actually editing the source, not while
    // merely adjacent to it.
    const from = pos + 1;
    const to = pos + node.nodeSize - 1;
    if (selection.from >= from && selection.to <= to) {
      found = { node, from: pos };
    }
  });
  return found;
}

/**
 * Math-specific extras on top of the shared enclosure model (see
 * enclosure.ts, which owns delimiter reveal and all cursor/key behavior):
 * while the cursor is away from a math node, its raw LaTeX source is hidden
 * and a KaTeX-rendered widget shown in its place (clicking the render puts
 * the cursor back inside); while the cursor is inside one, a floating live
 * preview follows along below the cursor so you can see the rendered result
 * while typing it.
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

          // The preview APPEARS on a short delay and hides immediately.
          // The selection can pass through a math node for a single update
          // without the user ever being "in" it - WKWebView caret
          // normalization around the delimiter widgets, autopair
          // conversions, fast arrowing - and an undebounced show makes the
          // box flash for a frame each time. While already visible, updates
          // (typing inside the formula) stay synchronous.
          let showTimer: number | null = null;
          const cancelShow = () => {
            if (showTimer !== null) {
              window.clearTimeout(showTimer);
              showTimer = null;
            }
          };
          // Hiding plays the box's short exit first (milkdown-theme.css);
          // coming back mid-exit just cancels it.
          let hideTimer: number | null = null;
          const cancelHide = () => {
            if (hideTimer !== null) {
              window.clearTimeout(hideTimer);
              hideTimer = null;
            }
            delete floatEl.dataset.state;
          };
          // The room closes with the box, not before it: the text does not
          // slide back under a box that is still fading out. (Leaving the
          // formula removes the room widget at once anyway.)
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
            // Nothing to preview until there's actual source - an empty
            // shell would show a bare floating box.
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
            // Brought into view as it opens and as typing grows it; a
            // scroll or a column move (follow) only re-places it, or it
            // would fight the user's own scrolling.
            place(view, true);
          }

          /** The room widget after the block formula at `from` (an inline
           *  formula has none). */
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
            // Below the formula, which matches how every other popup in this
            // app (grammar fixes, inline chat) appears below rather than
            // above: under a block's panel, centred on it; under the line an
            // inline formula ends on, starting at the caret so it tracks
            // along as you type. offsetWidth/Height, not the rect: the
            // pop-in plays as a scale.
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

            // A block's room, which it sits over so the paragraph below
            // moves down out of its way. Measured from the room's own top
            // (the panel's margin) and in layout px: the column is zoomed
            // with CSS zoom, the box (in <body>) is not.
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

            // Flipped above the caret only when even the room is cut off
            // (a window shorter than the box needs).
            const above = top + height > window.innerHeight - 8;
            if (above) {
              const lineTop = panel
                ? panel.getBoundingClientRect().top
                : view.coordsAtPos(view.state.selection.from).top;
              top = Math.max(8, lineTop - height - 10);
            }
            floatEl.style.left = `${left}px`;
            floatEl.style.top = `${top}px`;
            // It grows out of the corner nearest the caret (a block's, out
            // of the middle of its panel's edge).
            floatEl.style.setProperty(
              "--transform-origin",
              `${above ? "bottom" : "top"} ${block ? "center" : "left"}`,
            );
          }

          updateFloat(editorView);

          // The page can move under an open preview without a transaction:
          // the AI panel opening narrows the column, a scroll or a window
          // resize. It follows the caret instead of staying where it was.
          let frame = 0;
          let settleTimer: number | undefined;
          const placeIfShown = () => {
            if (floatEl.style.display !== "none") place(editorView);
          };
          const follow = () => {
            if (floatEl.style.display === "none" || hideTimer !== null) return;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(placeIfShown);
            // Once more where the column's glide to its new place
            // (App.tsx's FlipOnChange) has ended.
            window.clearTimeout(settleTimer);
            settleTimer = window.setTimeout(placeIfShown, 400);
          };
          const resize =
            typeof ResizeObserver === "undefined"
              ? null
              : new ResizeObserver(follow);
          resize?.observe(editorView.dom);
          // The pane, not just the text: a column that keeps its width
          // still moves when the pane beside it narrows.
          const pane = editorView.dom.closest(".editor-scroll");
          if (pane) resize?.observe(pane);
          window.addEventListener("resize", follow);
          document.addEventListener("scroll", follow, true);

          return {
            // Wrapped: the view-update callback's second argument is
            // prevState, which must not land in updateFloat's fromTimer.
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
