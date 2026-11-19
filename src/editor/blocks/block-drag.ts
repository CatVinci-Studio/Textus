import type { EditorView } from "@milkdown/kit/prose/view";
import { trackDrag } from "../../engine/drag/pointer-drag";
import { liftedCopy } from "../../engine/drag/ghost";
import { edgeScroll } from "../../engine/drag/edge-scroll";
import { flip } from "../../engine/motion/flip";
import { isMacPlatform } from "../../platform/os";
import {
  deleteBlock,
  gapsFor,
  gapsIn,
  landedAt,
  moveTo,
  placeAt,
  type HandledBlock,
} from "./block-commands";
import { boxIn, nearestGap } from "./block-handle-place";
import {
  blockLook,
  movingBlocks,
  openEditors,
  placeRoom,
  roomFor,
  type Pulled,
} from "./block-lift";
import { inLayout } from "../../engine/zoom/zoomed-rects";

const TEXT_BLOCK = /^(P|H[1-6]|LI|BLOCKQUOTE|UL|OL)$/;

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
    grip,
  }: {
    /** What `view` shows of the drag; null: nothing. */
    show: (view: EditorView, pulled: Pulled | null) => void;
    ended: () => void;
    held?: boolean;
    /** The handle pulled: carried on the lifted block, under the pointer. */
    grip?: HTMLElement;
  },
): void {
  const source = view.nodeDOM(block.pos) as HTMLElement | null;
  if (!source) return;
  const startState = view.state;
  let room: HTMLElement | null = null;
  let copy: ReturnType<typeof liftedCopy> | null = null;
  let aim: Aim = { view, landing: null };
  let last = { x: down.clientX, y: down.clientY };

  const end = block.pos + block.node.nodeSize;
  const style = getComputedStyle(source);
  const tall =
    source.offsetHeight +
    Math.max(
      parseFloat(style.marginTop) || 0,
      parseFloat(style.marginBottom) || 0,
    );

  /** Each place in `target` the block can go, laid out as it will stand
   *  with the block taken out of its own document. */
  const measured = (target: EditorView, root: HTMLElement) => {
    const own = target === view;
    const gaps = own
      ? gapsFor(target.state.doc, block)
      : gapsIn(target.state.doc, block.node.type.name === "list_item");
    // The block on its way out, and the room, aren't there to stand by.
    const tops = topLevelElements(target);
    const shown = (pos: number) => {
      const el = (tops.get(pos) ?? target.nodeDOM(pos)) as HTMLElement | null;
      return el?.isConnected && el.offsetParent && el !== source ? el : null;
    };
    // What is past the block moves up into its place.
    const top = (el: HTMLElement, pos: number) =>
      boxIn(root, el).y - (own && pos >= end ? tall : 0);
    // Next to the block, a place stands by what is past it: alone in its
    // list, where its top was.
    const after = (pos: number) => (own && pos === block.pos ? end : pos);
    const before = (pos: number) => (own && pos === end ? block.pos : pos);
    return gaps.map((gap) => {
      const $after = target.state.doc.resolve(after(gap.pos));
      const $before = target.state.doc.resolve(before(gap.pos));
      const next = $after.nodeAfter ? shown($after.pos) : null;
      const prevPos = $before.nodeBefore
        ? $before.pos - $before.nodeBefore.nodeSize
        : -1;
      const prev = prevPos >= 0 ? shown(prevPos) : null;
      const below = next ? top(next, $after.pos) : null;
      const above = prev ? top(prev, prevPos) + prev.offsetHeight : null;
      const home =
        own && (gap.pos === block.pos || gap.pos === end)
          ? boxIn(root, source).y
          : 0;
      const y =
        below !== null && above !== null
          ? (below + above) / 2
          : (below ?? above ?? home);
      const box =
        gap.container < 0
          ? boxIn(root, target.dom)
          : boxIn(root, target.nodeDOM(gap.container) as HTMLElement);
      return { pos: gap.pos, y, left: box.x, width: box.w };
    });
  };

  // Each editor's places as it stood before the drag touched it: read
  // live, the room opening and the block's place closing moved them under
  // the pointer, and the aim flipped back and forth.
  const layouts = new Map<EditorView, ReturnType<typeof measured>>();
  const layoutOf = (target: EditorView, root: HTMLElement) => {
    let gaps = layouts.get(target);
    if (!gaps) {
      gaps = measured(target, root);
      layouts.set(target, gaps);
    }
    return gaps;
  };
  /** The places as they stand with the room open at `at` (null: none):
   *  what is after it moved down by the block's height. */
  const withRoom = (gaps: ReturnType<typeof measured>, at: number | null) =>
    at === null
      ? gaps
      : gaps.map((g) => ({
          ...g,
          y: g.y + (g.pos > at ? tall : g.pos === at ? tall / 2 : 0),
        }));

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
    const at = inLayout(root, x, y);
    // Where the room is open in it now: its own place while it stays.
    const open =
      target === view
        ? aim.view === view
          ? (aim.landing ?? block.pos)
          : null
        : aim.view === target
          ? aim.landing
          : null;
    const gap = nearestGap(withRoom(layoutOf(target, root), open), at.x, at.y);
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
    if (room) {
      const at =
        next.view === view ? (next.landing ?? block.pos) : next.landing;
      const parent =
        at === null ? "" : next.view.state.doc.resolve(at).parent.type.name;
      placeRoom(room, /^(bullet|ordered)_list$/.test(parent));
    }
    const views = new Set([view, aim.view, next.view]);
    const blocks = [...views].flatMap(movingBlocks);
    flip(blocks, () => {
      if (aim.view !== view && aim.view !== next.view) show(aim.view, null);
      if (next.view !== view)
        show(next.view, {
          pos: null,
          landing: next.landing,
          room: next.landing === null ? null : room,
        });
      // At home, the room stands in its own place while it would stay.
      const home = next.view === view;
      show(view, {
        pos: block.pos,
        landing: home ? (next.landing ?? block.pos) : null,
        room: home ? room : null,
      });
    });
    aim = next;
  };

  const place = (x: number, y: number) => showAim(aimAt(x, y));

  // Near the aimed editor's top or bottom, it scrolls on while the
  // pointer stays there.
  const edge = edgeScroll(
    () => aim.view.dom.closest<HTMLElement>(".editor-scroll"),
    () => place(last.x, last.y),
  );

  const lift = (x: number, y: number) => {
    const root = openEditors.get(view);
    if (root) layoutOf(view, root);
    copy = liftedCopy(source, {
      keep: true,
      // Lines of text as wide as their words; a block in a box of its own
      // (code, a table, a diagram) at the box's size, as its room is.
      fit: TEXT_BLOCK.test(source.tagName),
      wrap: blockLook(source, view),
    });
    room = roomFor(source, copy.element);
    if (grip) carryGrip(copy.element, grip);
    placeRoom(room, block.node.type.name === "list_item");
    show(view, { pos: block.pos, landing: block.pos, room });
    last = { x, y };
    place(x, y);
  };

  /** Puts the block down where it is aimed; the document it lands in, and
   *  where it starts there, or null when nothing moved. */
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
      return { into: view, at: landedAt(tr) };
    }
    const tr = placeAt(target.state, startState, block, landing);
    if (!tr) return null;
    target.dispatch(tr);
    if (!copying) view.dispatch(deleteBlock(view.state, block));
    return { into: target, at: landedAt(tr) };
  };

  trackDrag(
    down,
    {
      start: lift,
      move: (x, y) => {
        copy?.moveBy(x - down.clientX, y - down.clientY);
        last = { x, y };
        place(x, y);
        edge.at(y);
      },
      end: (_x, _y, dropped, e) => {
        edge.stop();
        const copying = !!e && (isMacPlatform() ? e.altKey : e.ctrlKey);
        const landed = dropped ? drop(copying) : null;
        if (aim.view !== view) show(aim.view, null);
        show(view, null);
        // The copy settles where the block is now, moved or not.
        const into = landed?.into ?? view;
        const now = into.nodeDOM(landed?.at ?? block.pos);
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

/** A copy of `grip` on `lifted`, where it stood beside the block: what the
 *  pointer holds goes along with it. */
function carryGrip(lifted: HTMLElement, grip: HTMLElement) {
  const g = grip.getBoundingClientRect();
  const l = lifted.getBoundingClientRect();
  if (!g.width || !lifted.offsetWidth) return;
  const scale = l.width / lifted.offsetWidth;
  const carried = grip.cloneNode(true) as HTMLElement;
  carried.classList.add("block-drag-grip");
  Object.assign(carried.style, {
    left: `${(g.left - l.left) / scale}px`,
    top: `${(g.top - l.top) / scale}px`,
    width: `${g.width / scale}px`,
    height: `${g.height / scale}px`,
  });
  lifted.append(carried);
}

/** The editor's top-level blocks' elements by position, in one pass: a
 *  lookup each would scan the editor's children every time. */
function topLevelElements(view: EditorView): Map<number, Element> {
  const { doc } = view.state;
  const found = new Map<number, Element>();
  let next = 0;
  let pos = 0;
  for (const el of view.dom.children) {
    if (next >= doc.childCount) break;
    const desc = (el as { pmViewDesc?: { node?: unknown } }).pmViewDesc;
    if (desc?.node !== doc.child(next)) continue;
    found.set(pos, el);
    pos += doc.child(next++).nodeSize;
  }
  return found;
}
