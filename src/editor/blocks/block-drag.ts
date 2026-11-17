import type { EditorView } from "@milkdown/kit/prose/view";
import { scaledPx } from "../../engine/tokens/chrome-scale";
import { trackDrag } from "../../engine/drag/pointer-drag";
import { liftedCopy } from "../../engine/drag/ghost";
import { flip } from "../../engine/motion/flip";
import { isMacPlatform } from "../../platform/os";
import {
  deleteBlock,
  gapsFor,
  gapsIn,
  moveTo,
  placeAt,
  type HandledBlock,
} from "./block-commands";
import { boxIn, nearestGap } from "./block-handle-place";
import {
  blockLook,
  movingBlocks,
  openEditors,
  roomFor,
  type Pulled,
} from "./block-lift";

/** How near the scroller's edge the pointer scrolls it, and how fast. */
const EDGE = 48;
const STEP = 16;

/** Where a pulled block is aimed: an editor, and the place in it. */
interface Aim {
  view: EditorView;
  landing: number | null;
}

/**
 * The block under the handle, pulled, as an island is: the block itself
 * lifts off the page and follows the pointer, and where it would land -
 * in its own document or another open beside it - room opens, the blocks
 * around moving aside; let go, it settles there in one undo step (one in
 * each document it leaves and enters). With Option (Ctrl off a Mac) a
 * copy goes and the block stays. Esc drops nothing. `held`: a finger held
 * on the handle, lifted at once rather than after it moves.
 */
export function dragBlock(
  view: EditorView,
  block: HandledBlock,
  down: PointerEvent,
  {
    show,
    ended,
    held = false,
  }: {
    /** What `view` shows of the drag; null: nothing. */
    show: (view: EditorView, pulled: Pulled | null) => void;
    ended: () => void;
    held?: boolean;
  },
): void {
  const source = view.nodeDOM(block.pos) as HTMLElement | null;
  if (!source) return;
  const startState = view.state;
  const room = roomFor(source);
  let copy: ReturnType<typeof liftedCopy> | null = null;
  let aim: Aim = { view, landing: null };
  let scrolling = 0;
  let last = { x: down.clientX, y: down.clientY };

  /** Each place in `target` the block can go, laid out now. */
  const measured = (target: EditorView, root: HTMLElement) => {
    const own = target === view;
    const gaps = own
      ? gapsFor(target.state.doc, block)
      : gapsIn(target.state.doc, block.node.type.name === "list_item");
    // The block on its way out, and the room, aren't there to stand by.
    const shown = (pos: number) => {
      const el = target.nodeDOM(pos) as HTMLElement | null;
      return el?.isConnected && el.offsetParent && el !== source ? el : null;
    };
    return gaps.map((gap) => {
      const $gap = target.state.doc.resolve(gap.pos);
      const after = $gap.nodeAfter ? shown(gap.pos) : null;
      const before = $gap.nodeBefore
        ? shown(gap.pos - $gap.nodeBefore.nodeSize)
        : null;
      const top = after ? boxIn(root, after).y : null;
      const bottom = before
        ? boxIn(root, before).y + before.offsetHeight
        : null;
      const y =
        top !== null && bottom !== null
          ? (top + bottom) / 2
          : (top ?? bottom ?? 0);
      const box =
        gap.container < 0
          ? boxIn(root, target.dom)
          : boxIn(root, target.nodeDOM(gap.container) as HTMLElement);
      return { pos: gap.pos, y, left: box.x, width: box.w };
    });
  };

  /** The pointer in `root`'s units: the document's zoom taken off. */
  const inRoot = (root: HTMLElement, x: number, y: number) => {
    const r = root.getBoundingClientRect();
    const zoom = r.width / root.offsetWidth || 1;
    return { x: (x - r.left) / zoom, y: (y - r.top) / zoom };
  };

  /** The open editor under the pointer: its scroller's box, on screen. */
  const editorAt = (x: number, y: number): EditorView => {
    for (const [target] of openEditors) {
      const area = target.dom.closest(".editor-scroll") ?? target.dom;
      const r = area.getBoundingClientRect();
      if (r.width && x >= r.left && x < r.right && y >= r.top && y < r.bottom)
        return target;
    }
    return aim.view;
  };

  /** Where the block lands for the pointer at `x, y`: null, back where it
   *  was (or nowhere it can go). */
  const aimAt = (x: number, y: number): Aim => {
    const target = editorAt(x, y);
    const root = openEditors.get(target);
    if (!root) return { view: target, landing: null };
    const at = inRoot(root, x, y);
    const gap = nearestGap(measured(target, root), at.x, at.y);
    if (!gap) return { view: target, landing: null };
    const fits =
      target === view
        ? moveTo(target.state, block, gap.pos) !== null
        : placeAt(target.state, startState, block, gap.pos) !== null;
    return { view: target, landing: fits ? gap.pos : null };
  };

  /** What each editor shows of `next`, the blocks around sliding aside. */
  const showAim = (next: Aim) => {
    if (next.view === aim.view && next.landing === aim.landing) return;
    const views = new Set([view, aim.view, next.view]);
    const blocks = [...views].flatMap(movingBlocks);
    flip(blocks, () => {
      if (aim.view !== view && aim.view !== next.view) show(aim.view, null);
      if (next.view !== view)
        show(next.view, {
          pos: null,
          staying: false,
          landing: next.landing,
          room: next.landing === null ? null : room,
        });
      const home = next.view === view;
      show(view, {
        pos: block.pos,
        staying: home && next.landing === null,
        landing: home ? next.landing : null,
        room: home && next.landing !== null ? room : null,
      });
    });
    aim = next;
  };

  const place = (x: number, y: number) => showAim(aimAt(x, y));

  // Near the scroller's top or bottom, it scrolls on while the pointer
  // stays there.
  const scrollNear = () => {
    scrolling = 0;
    const scroller = aim.view.dom.closest<HTMLElement>(".editor-scroll");
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
    copy = liftedCopy(source, {
      keep: true,
      wrap: blockLook(source, view),
    });
    show(view, { pos: block.pos, staying: true, landing: null, room: null });
    last = { x, y };
    place(x, y);
  };

  /** Puts the block down where it is aimed; the document it lands in, and
   *  where, or null when nothing moved. */
  const drop = (copying: boolean) => {
    const { view: target, landing } = aim;
    // A document changed under the drag (an AI edit landing): its places
    // are gone, so nothing moves.
    if (landing === null || view.state.doc !== startState.doc) return null;
    if (target === view) {
      const tr = copying
        ? placeAt(view.state, view.state, block, landing)
        : moveTo(view.state, block, landing);
      if (!tr) return null;
      view.dispatch(tr);
      return view;
    }
    const tr = placeAt(target.state, startState, block, landing);
    if (!tr) return null;
    target.dispatch(tr);
    if (!copying) view.dispatch(deleteBlock(view.state, block));
    return target;
  };

  trackDrag(
    down,
    {
      start: lift,
      move: (x, y) => {
        copy?.moveBy(x - down.clientX, y - down.clientY);
        last = { x, y };
        place(x, y);
        if (!scrolling) scrolling = requestAnimationFrame(scrollNear);
      },
      end: (_x, _y, dropped, e) => {
        cancelAnimationFrame(scrolling);
        const copying = !!e && (isMacPlatform() ? e.altKey : e.ctrlKey);
        const landed = dropped ? drop(copying) : null;
        if (aim.view !== view) show(aim.view, null);
        show(view, null);
        // The copy settles where the block is now, moved or not.
        const into = landed ?? view;
        const now = into.nodeDOM(
          landed ? into.state.selection.from : block.pos,
        );
        if (copy && now instanceof HTMLElement)
          copy.land(now.getBoundingClientRect());
        else copy?.remove();
        into.focus();
        ended();
      },
    },
    { started: held },
  );
  if (held) lift(down.clientX, down.clientY);
}
