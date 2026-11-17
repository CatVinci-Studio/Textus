import type { EditorView } from "@milkdown/kit/prose/view";
import { scaledPx } from "../../engine/tokens/chrome-scale";
import { trackDrag } from "../../engine/drag/pointer-drag";
import { dragGhost } from "../../engine/drag/ghost";
import { gapsFor, moveTo, type HandledBlock } from "./block-commands";
import { boxIn, nearestGap } from "./block-handle-place";

/** How near the scroller's edge the pointer scrolls it, and how fast. */
const EDGE = 48;
const STEP = 16;

/**
 * The block under the handle, pulled: a copy follows the pointer, the
 * block stays in place marked as the one moving, and a line shows where it
 * will land; let go, it moves there in one undo step. Esc drops nothing.
 * `held`: a finger held on the handle, lifted at once rather than after
 * it moves.
 */
export function dragBlock(
  view: EditorView,
  root: HTMLElement,
  block: HandledBlock,
  down: PointerEvent,
  {
    started,
    ended,
    held = false,
  }: { started: () => void; ended: () => void; held?: boolean },
): void {
  const source = view.nodeDOM(block.pos) as HTMLElement | null;
  if (!source) return;
  const doc = view.state.doc;
  const gaps = gapsFor(doc, block);
  const line = document.createElement("div");
  line.className = "block-drop-line";
  line.setAttribute("aria-hidden", "true");
  const scroller = root.closest<HTMLElement>(".editor-scroll");
  let ghost: ReturnType<typeof dragGhost> | null = null;
  let landing: number | null = null;
  let scrolling = 0;
  let last = { x: down.clientX, y: down.clientY };

  /** Each gap's height and left, as laid out now: blocks drawn late (a
   *  long document's) grow as the page scrolls. */
  const measured = () =>
    gaps.map((gap) => {
      const $gap = view.state.doc.resolve(gap.pos);
      const after = $gap.nodeAfter
        ? (view.nodeDOM(gap.pos) as HTMLElement | null)
        : null;
      const before = $gap.nodeBefore
        ? (view.nodeDOM(
            gap.pos - $gap.nodeBefore.nodeSize,
          ) as HTMLElement | null)
        : null;
      const top = after?.isConnected ? boxIn(root, after).y : null;
      const bottom = before?.isConnected
        ? boxIn(root, before).y + before.offsetHeight
        : null;
      const y =
        top !== null && bottom !== null
          ? (top + bottom) / 2
          : (top ?? bottom ?? 0);
      const box =
        gap.container < 0
          ? boxIn(root, view.dom)
          : boxIn(root, view.nodeDOM(gap.container) as HTMLElement);
      return { pos: gap.pos, y, left: box.x, width: box.w };
    });

  /** The pointer in the editor's units: the document's zoom taken off. */
  const inRoot = (x: number, y: number) => {
    const r = root.getBoundingClientRect();
    const zoom = r.width / root.offsetWidth || 1;
    return { x: (x - r.left) / zoom, y: (y - r.top) / zoom };
  };

  const place = (x: number, y: number) => {
    const at = inRoot(x, y);
    const gap = nearestGap(measured(), at.x, at.y);
    landing = gap?.pos ?? null;
    line.hidden = !gap;
    if (gap) {
      line.style.translate = `${gap.left}px ${gap.y}px`;
      line.style.width = `${gap.width}px`;
    }
  };

  // Near the scroller's top or bottom, it scrolls on while the pointer
  // stays there.
  const scrollNear = () => {
    scrolling = 0;
    if (!scroller) return;
    const r = scroller.getBoundingClientRect();
    const by =
      last.y < r.top + scaledPx(EDGE)
        ? -STEP
        : last.y > r.bottom - scaledPx(EDGE)
          ? STEP
          : 0;
    if (!by) return;
    scroller.scrollTop += by;
    place(last.x, last.y);
    scrolling = requestAnimationFrame(scrollNear);
  };

  const lift = (x: number, y: number) => {
    started();
    root.append(line);
    ghost = dragGhost(
      source.textContent?.trim().slice(0, 60) || "¶",
      "tx-drag-ghost block-drag-ghost",
    );
    ghost.move(x, y);
    place(x, y);
  };

  trackDrag(
    down,
    {
      start: lift,
      move: (x, y) => {
        last = { x, y };
        ghost?.move(x, y);
        place(x, y);
        if (!scrolling) scrolling = requestAnimationFrame(scrollNear);
      },
      end: (_x, _y, dropped) => {
        cancelAnimationFrame(scrolling);
        line.remove();
        ghost?.remove();
        // The document changed under the drag (an AI edit landing): its
        // places are gone, so nothing moves.
        if (dropped && landing !== null && view.state.doc === doc) {
          const tr = moveTo(view.state, block, landing);
          if (tr) view.dispatch(tr);
        }
        view.focus();
        ended();
      },
    },
    { started: held },
  );
  if (held) lift(down.clientX, down.clientY);
}
