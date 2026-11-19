import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import {
  BLOCK_MENU_EVENT,
  type BlockMenuRequest,
  sendAppEvent,
} from "../../utils/events";
import { blockAround, type HandledBlock } from "./block-commands";
import { openEditors, pulledDecorations, type Pulled } from "./block-lift";
import { dragBlock } from "./block-drag";
import { boxIn, handlePlace } from "./block-handle-place";
import { GRIP_ICON_HTML } from "../../engine/controls/icons";
import { foldCaret, labelFoldCaret } from "../fold/block-fold";
import { headingFold } from "../fold/heading-fold";
import { TOUCH_SLOP_PX } from "../../utils/gesture";
import { canHaptic } from "../../platform/capabilities";
import { nativeFiles } from "../../platform/native-files";
import "./block-handles.css";

/** Room a list item's marker takes left of its text, in ems. */
const MARKER_EM: Record<string, number> = {
  bullet_list: 0.9,
  ordered_list: 1.6,
};

/** How long a finger rests on ⋮⋮ before the block lifts. */
const HOLD_MS = 450;

/** How long the mouse rests on a block before its tools come: one passing
 *  over on its way elsewhere brings nothing. */
const DWELL_MS = 100;

/**
 * ⋮⋮ in the margin beside the block the mouse rests on, with the block's
 * fold caret: clicked, its menu; pulled, it moves the block. Gone while
 * typing, until the mouse moves again; never in a document that can't be
 * edited. Under a finger, ⋮⋮ alone stands by the block with the caret:
 * tapped, its menu; held, the block lifts to be moved.
 */
function blockHandlesPlugin(options: { enabled: () => boolean }) {
  return new Plugin<Pulled | null>({
    key: pulled,
    // A block being pulled, as this editor shows it: a class set on its
    // element ProseMirror would draw away.
    state: {
      init: () => null,
      apply: (tr, now) => {
        const meta = tr.getMeta(pulled) as Pulled | null | undefined;
        if (meta !== undefined) return meta;
        if (!now || !tr.docChanged) return now;
        const map = (pos: number | null) =>
          pos === null ? null : tr.mapping.map(pos);
        return { ...now, pos: map(now.pos), landing: map(now.landing) };
      },
    },
    props: {
      decorations: (state) =>
        pulledDecorations(state.doc, pulled.getState(state) ?? null),
    },
    view: (view) => new BlockHandles(view, options.enabled),
  });
}

const pulled = new PluginKey<Pulled | null>("block-handles");

/** What `view` shows of a block being pulled; null: nothing. */
const showPulled = (view: EditorView, state: Pulled | null) =>
  view.dispatch(
    view.state.tr.setMeta(pulled, state).setMeta("addToHistory", false),
  );

export const createBlockHandlesPlugin = (options: { enabled: () => boolean }) =>
  $prose(() => blockHandlesPlugin(options));

class BlockHandles {
  private readonly root: HTMLElement;
  private readonly handle = document.createElement("div");
  private readonly grip = button("block-handle-grip", GRIP_ICON_HTML);
  /** A top-level heading's fold, left of ⋮⋮ (heading-fold.ts). */
  private readonly fold = foldButton();
  private block: HandledBlock | null = null;
  /** The fold caret shown for the block the mouse is near. */
  private caret: HTMLElement | null = null;
  /** The mouse's last place, for the rest it makes before tools come. */
  private pointer = { x: 0, y: 0 };
  private dwell: ReturnType<typeof setTimeout> | undefined;
  private dragging = false;
  /** ⋮⋮ pressed and not let go: a pull, not text being chosen. */
  private gripped = false;
  /** The last press was a finger's or a pen's, not a mouse's. */
  private touch = false;
  private readonly area: HTMLElement;

  constructor(
    private readonly view: EditorView,
    private readonly enabled: () => boolean,
  ) {
    this.root = view.dom.parentElement as HTMLElement;
    this.area = view.dom.closest<HTMLElement>(".editor-scroll") ?? this.root;
    this.handle.className = "block-handle";
    this.handle.hidden = true;
    this.handle.setAttribute("aria-hidden", "true");
    this.handle.append(this.fold, this.grip);
    this.root.append(this.handle);
    openEditors.set(view, this.root);
    this.area.addEventListener("pointerdown", this.onPress, true);
    this.area.addEventListener("pointermove", this.onMove);
    this.area.addEventListener("pointerleave", this.onLeave);
    view.dom.addEventListener("keydown", this.leave);
    this.grip.addEventListener("click", this.onClick);
    this.grip.addEventListener("pointerdown", this.onGrip);
    this.fold.addEventListener("click", this.onFold);
  }

  private readonly onFold = (e: MouseEvent) => {
    e.preventDefault();
    if (this.block) headingFold(this.view, this.block.pos)?.toggle();
  };

  private readonly onPress = (e: PointerEvent) => {
    const touch = e.pointerType !== "mouse";
    if (touch === this.touch) return;
    this.touch = touch;
    this.handle.classList.toggle("by-touch", touch);
    // A mouse after a finger: the handle goes, unless it is what's pressed.
    if (!touch && !this.handle.contains(e.target as Node)) this.leave();
  };

  private readonly onMove = (e: PointerEvent) => {
    if (this.dragging || this.gripped || e.pointerType !== "mouse") return;
    // Over the handle itself: it stays for the block it stands for.
    if (this.handle.contains(e.target as Node)) return;
    // A button held: text being chosen, not a block reached for.
    if (e.buttons !== 0) return this.leave();
    this.pointer = { x: e.clientX, y: e.clientY };
    if (!this.blockOnLine()) return this.leave();
    // Shown already: they follow from block to block at once.
    if (this.block || this.caret) return this.reveal();
    clearTimeout(this.dwell);
    this.dwell = setTimeout(() => this.reveal(), DWELL_MS);
  };

  /** The block on the mouse's line, from the margin across, if any. */
  private blockOnLine(): HandledBlock | null {
    const { x, y } = this.pointer;
    const content = this.view.dom.getBoundingClientRect();
    if (y < content.top || y > content.bottom) return null;
    // From the margins too: the block on the pointer's line.
    const at = this.view.posAtCoords({
      left: Math.min(Math.max(x, content.left + 2), content.right - 2),
      top: y,
    });
    const around =
      at &&
      blockAround(this.view.state.doc, at.inside >= 0 ? at.inside : at.pos);
    if (!around) return null;
    const block = itemOnLine(this.view, around, y);
    const dom = this.view.nodeDOM(block.pos);
    return dom instanceof HTMLElement && dom.isConnected ? block : null;
  }

  /** The tools of the block the mouse is on: its fold caret, and ⋮⋮
   *  where the document can be edited and handles are on. */
  private reveal() {
    const block = this.blockOnLine();
    if (!block) return this.leave();
    this.markCaret(this.pointer.y);
    this.show(block);
  }

  /** Shows the fold caret of the block on line `y`, and no other. */
  private markCaret(y: number) {
    let found: HTMLElement | null = null;
    for (const caret of this.view.dom.querySelectorAll<HTMLElement>(
      ".block-fold",
    )) {
      const r = caret.parentElement?.getBoundingClientRect();
      if (r && r.height > 0 && y >= r.top && y < r.bottom) found = caret;
    }
    if (found === this.caret) return;
    this.caret?.removeAttribute("data-near");
    found?.setAttribute("data-near", "");
    this.caret = found;
  }

  // A finger lifting leaves too; under a finger the handle follows the
  // caret, not the pointer.
  private readonly onLeave = (e: PointerEvent) => {
    if (!this.dragging && e.pointerType === "mouse") this.leave();
  };

  /** The mouse gone from the blocks, or typing: no tools. */
  private readonly leave = () => {
    clearTimeout(this.dwell);
    this.markCaret(Number.NaN);
    this.hide();
  };

  private readonly hide = () => {
    this.block = null;
    this.handle.hidden = true;
  };

  /** ⋮⋮ for `block` where it can be moved, and a heading's fold caret
   *  where it has one and isn't folded (folded, its own caret stands
   *  there: heading-fold-marks.ts). */
  private show(block: HandledBlock) {
    const dom = this.view.nodeDOM(block.pos) as HTMLElement | null;
    if (!dom?.isConnected) return this.hide();
    const grip = this.enabled() && this.view.editable;
    const fold = headingFold(this.view, block.pos);
    const caret = !!fold && !fold.folded;
    if (!grip && !caret) return this.hide();
    this.grip.hidden = !grip;
    this.fold.hidden = !caret;
    if (caret) labelFoldCaret(this.fold, false, dom.textContent ?? "");
    this.block = block;
    this.handle.hidden = false;
    // Beside a fold caret (a drawn block's, a heading's), a finger's ⋮⋮
    // leaves the margin left of it to the caret.
    this.handle.toggleAttribute(
      "data-beside-fold",
      dom.classList.contains("block-foldable") || /^H[1-6]$/.test(dom.tagName),
    );
    const style = getComputedStyle(dom);
    const fontSize = parseFloat(style.fontSize) || 16;
    const firstLine = dom.querySelector<HTMLElement>(
      "p, h1, h2, h3, h4, h5, h6",
    );
    const lineHeight =
      parseFloat(getComputedStyle(firstLine ?? dom).lineHeight) ||
      fontSize * 1.6;
    const list = this.view.state.doc.resolve(block.pos).parent.type.name;
    const task = dom.dataset.itemType === "task";
    const { x, y } = handlePlace(
      boxIn(this.root, dom),
      lineHeight,
      { w: this.handle.offsetWidth, h: this.handle.offsetHeight },
      task ? 0 : (MARKER_EM[list] ?? 0) * fontSize,
    );
    this.handle.style.translate = `${x}px ${y}px`;
  }

  private readonly onClick = (e: MouseEvent) => {
    e.preventDefault();
    // A finger's tap opened it as it lifted.
    if (!this.touch) this.openMenu();
  };

  private openMenu() {
    if (!this.block) return;
    const r = this.grip.getBoundingClientRect();
    const request: BlockMenuRequest = {
      dom: this.view.dom,
      x: r.left,
      y: r.bottom,
      pos: this.block.pos,
    };
    sendAppEvent(BLOCK_MENU_EVENT, request);
  }

  private readonly onGrip = (e: PointerEvent) => {
    const block = this.block;
    if (!block || e.button !== 0) return;
    const drag = (held: boolean) =>
      dragBlock(this.view, block, e, {
        held,
        grip: this.grip,
        show: (view, state) => {
          if (view === this.view && state) {
            this.dragging = true;
            // Lifted, the block takes its handle along.
            this.handle.hidden = true;
          }
          showPulled(view, state);
        },
        ended: () => {
          this.dragging = false;
          if (!this.touch) this.hide();
        },
      });
    if (e.pointerType === "mouse") {
      this.gripped = true;
      const free = () => {
        this.gripped = false;
        window.removeEventListener("pointerup", free, true);
        window.removeEventListener("pointercancel", free, true);
      };
      window.addEventListener("pointerup", free, true);
      window.addEventListener("pointercancel", free, true);
      return drag(false);
    }
    // No mousedown made of the finger after it lifts: it would land
    // outside the menu just opened and close it.
    e.preventDefault();
    // A finger: a tap is the menu, a rest lifts the block. The tap is
    // read from the finger itself: the click a web view makes of it may
    // land on the text instead.
    const from = { x: e.clientX, y: e.clientY };
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", moved);
      window.removeEventListener("pointerup", tapped);
      window.removeEventListener("pointercancel", stop);
    };
    const tapped = () => {
      stop();
      this.openMenu();
    };
    const moved = (m: PointerEvent) => {
      if (Math.hypot(m.clientX - from.x, m.clientY - from.y) > TOUCH_SLOP_PX)
        stop();
    };
    const timer = setTimeout(() => {
      stop();
      if (canHaptic) nativeFiles.haptic();
      drag(true);
    }, HOLD_MS);
    window.addEventListener("pointermove", moved);
    window.addEventListener("pointerup", tapped);
    window.addEventListener("pointercancel", stop);
  };

  update() {
    if (this.dragging) return;
    // Under a finger: beside the block with the caret, while writing.
    if (this.touch) {
      const { view } = this;
      const block = view.hasFocus()
        ? blockAround(view.state.doc, view.state.selection.from)
        : null;
      if (block) this.show(block);
      else this.hide();
      return;
    }
    // The block moved or went, or its fold changed: placed again on the
    // next move.
    if (
      this.block &&
      (this.view.state.doc.nodeAt(this.block.pos) !== this.block.node ||
        (!this.fold.hidden && headingFold(this.view, this.block.pos)?.folded))
    )
      this.hide();
  }

  destroy() {
    this.area.removeEventListener("pointerdown", this.onPress, true);
    this.area.removeEventListener("pointermove", this.onMove);
    this.area.removeEventListener("pointerleave", this.onLeave);
    this.view.dom.removeEventListener("keydown", this.leave);
    clearTimeout(this.dwell);
    this.handle.remove();
    openEditors.delete(this.view);
  }
}

/** In a list's margin (its markers) the pointer's line reads as the list
 *  around its items: the innermost item on that line stands for it, the
 *  nearest one between two. */
function itemOnLine(
  view: EditorView,
  block: HandledBlock,
  y: number,
): HandledBlock {
  let found = block;
  let parent = block;
  for (;;) {
    let hit: HandledBlock | null = null;
    let nearest: { block: HandledBlock; d: number } | null = null;
    let offset = 0;
    for (let i = 0; i < parent.node.childCount; i++) {
      const child = parent.node.child(i);
      const at = parent.pos + 1 + offset;
      offset += child.nodeSize;
      const name = child.type.name;
      if (name !== "list_item" && !LISTS.test(name)) continue;
      const dom = view.nodeDOM(at) as HTMLElement | null;
      if (!dom) continue;
      const r = dom.getBoundingClientRect();
      const d = y < r.top ? r.top - y : y >= r.bottom ? y - r.bottom : 0;
      const here = { pos: at, node: child };
      if (d === 0) hit ??= here;
      if (!nearest || d < nearest.d) nearest = { block: here, d };
    }
    // Between two items of the list the pointer came in by, the nearer.
    const next: HandledBlock | null =
      hit ?? (found === block ? (nearest?.block ?? null) : null);
    if (!next || (hit === null && !LISTS.test(block.node.type.name)))
      return found;
    if (next.node.type.name === "list_item") found = next;
    parent = next;
  }
}

const LISTS = /^(bullet_list|ordered_list)$/;

function button(className: string, icon: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `block-handle-button ${className}`;
  el.innerHTML = icon;
  // A pointer's way only: the right-click menu, Alt+Up and Alt+Down do the
  // same from the keyboard.
  el.tabIndex = -1;
  // Pressed, the text keeps the keyboard (and a finger's handle its block).
  el.addEventListener("mousedown", (e) => e.preventDefault());
  return el;
}

/** The fold caret ⋮⋮ carries for a heading, drawn as the drawn blocks'. */
function foldButton(): HTMLButtonElement {
  const el = foldCaret();
  el.className = "block-handle-button block-handle-fold";
  el.tabIndex = -1;
  el.hidden = true;
  el.addEventListener("mousedown", (e) => e.preventDefault());
  return el;
}
