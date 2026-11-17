import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import {
  BLOCK_MENU_EVENT,
  type BlockMenuRequest,
  sendAppEvent,
} from "../../utils/events";
import { blockAround, type HandledBlock } from "./block-commands";
import { dragBlock } from "./block-drag";
import { boxIn, handlePlace } from "./block-handle-place";
import { GRIP_ICON_HTML, PLUS_ICON_HTML } from "../../engine/controls/icons";
import { TOUCH_SLOP_PX } from "../../utils/gesture";
import { canHaptic } from "../../platform/capabilities";
import { iosFiles } from "../../platform/ios-files";
import "./block-handles.css";

/** Room a list item's marker takes left of its text, in ems. */
const MARKER_EM: Record<string, number> = {
  bullet_list: 0.9,
  ordered_list: 1.6,
};

/** How long a finger rests on ⋮⋮ before the block lifts. */
const HOLD_MS = 450;

/**
 * ＋ and ⋮⋮ in the margin beside the block under a mouse: ＋ opens the list
 * of blocks to add below it, ⋮⋮ its menu, and pulled, moves it. Gone while
 * typing, until the mouse moves again; never in a document that can't be
 * edited. Under a finger, ⋮⋮ alone stands by the block with the caret:
 * tapped, its menu; held, the block lifts to be moved.
 */
function blockHandlesPlugin(options: { enabled: () => boolean }) {
  return new Plugin<number | null>({
    key: pulled,
    // The block being pulled, marked as the one moving: a class set on its
    // element ProseMirror would draw away.
    state: {
      init: () => null,
      apply: (tr, at) => {
        const meta = tr.getMeta(pulled) as number | null | undefined;
        if (meta !== undefined) return meta;
        return at == null ? null : tr.mapping.map(at);
      },
    },
    props: {
      decorations(state) {
        const at = pulled.getState(state);
        const node = at == null ? null : state.doc.nodeAt(at);
        return node
          ? DecorationSet.create(state.doc, [
              Decoration.node(at!, at! + node.nodeSize, {
                class: "tx-drag-source",
              }),
            ])
          : null;
      },
    },
    view: (view) => new BlockHandles(view, options.enabled),
  });
}

const pulled = new PluginKey<number | null>("block-handles");

/** Marks the block at `pos` as the one being pulled; null: none. */
const markPulled = (view: EditorView, pos: number | null) =>
  view.dispatch(
    view.state.tr.setMeta(pulled, pos).setMeta("addToHistory", false),
  );

export const createBlockHandlesPlugin = (options: { enabled: () => boolean }) =>
  $prose(() => blockHandlesPlugin(options));

class BlockHandles {
  private readonly root: HTMLElement;
  private readonly handle = document.createElement("div");
  private readonly add = button("block-handle-add", PLUS_ICON_HTML);
  private readonly grip = button("block-handle-grip", GRIP_ICON_HTML);
  private block: HandledBlock | null = null;
  private dragging = false;
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
    this.handle.append(this.add, this.grip);
    this.root.append(this.handle);
    this.area.addEventListener("pointerdown", this.onPress, true);
    this.area.addEventListener("pointermove", this.onMove);
    this.area.addEventListener("pointerleave", this.onLeave);
    view.dom.addEventListener("keydown", this.hide);
    this.add.addEventListener("click", (e) => this.onClick(e, true));
    this.grip.addEventListener("click", (e) => this.onClick(e, false));
    this.grip.addEventListener("pointerdown", this.onGrip);
  }

  private readonly onPress = (e: PointerEvent) => {
    const touch = e.pointerType !== "mouse";
    if (touch === this.touch) return;
    this.touch = touch;
    this.handle.classList.toggle("by-touch", touch);
    if (!touch) this.hide();
  };

  private readonly onMove = (e: PointerEvent) => {
    if (this.dragging || e.pointerType !== "mouse") return;
    if (!this.enabled() || !this.view.editable) return this.hide();
    // Over the handle itself: it stays for the block it stands for.
    if (this.handle.contains(e.target as Node)) return;
    const content = this.view.dom.getBoundingClientRect();
    if (e.clientY < content.top || e.clientY > content.bottom)
      return this.hide();
    // From the margin too: the block on the pointer's line.
    const at = this.view.posAtCoords({
      left: Math.max(e.clientX, content.left + 2),
      top: e.clientY,
    });
    const block =
      at &&
      blockAround(this.view.state.doc, at.inside >= 0 ? at.inside : at.pos);
    if (!block) return this.hide();
    this.show(block);
  };

  private readonly onLeave = () => {
    if (!this.dragging) this.hide();
  };

  private readonly hide = () => {
    this.block = null;
    this.handle.hidden = true;
  };

  private show(block: HandledBlock) {
    const dom = this.view.nodeDOM(block.pos) as HTMLElement | null;
    if (!dom?.isConnected) return this.hide();
    this.block = block;
    this.handle.hidden = false;
    // A drawn block with a fold caret in the margin keeps ⋮⋮ only.
    this.add.hidden = dom.classList.contains("block-foldable");
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

  private onClick(e: MouseEvent, add: boolean) {
    e.preventDefault();
    // A finger's tap opened it as it lifted.
    if (!this.touch) this.openMenu(add);
  }

  private openMenu(add: boolean) {
    if (!this.block) return;
    const r = (add ? this.add : this.grip).getBoundingClientRect();
    const request: BlockMenuRequest = {
      dom: this.view.dom,
      x: r.left,
      y: r.bottom,
      pos: this.block.pos,
      add,
    };
    sendAppEvent(BLOCK_MENU_EVENT, request);
  }

  private readonly onGrip = (e: PointerEvent) => {
    const block = this.block;
    if (!block || e.button !== 0) return;
    const drag = (held: boolean) =>
      dragBlock(this.view, this.root, block, e, {
        held,
        started: () => {
          this.dragging = true;
          markPulled(this.view, block.pos);
        },
        ended: () => {
          this.dragging = false;
          markPulled(this.view, null);
          if (!this.touch) this.hide();
        },
      });
    if (e.pointerType === "mouse") return drag(false);
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
      this.openMenu(false);
    };
    const moved = (m: PointerEvent) => {
      if (Math.hypot(m.clientX - from.x, m.clientY - from.y) > TOUCH_SLOP_PX)
        stop();
    };
    const timer = setTimeout(() => {
      stop();
      if (canHaptic) iosFiles.haptic();
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
      const block =
        this.enabled() && view.editable && view.hasFocus()
          ? blockAround(view.state.doc, view.state.selection.from)
          : null;
      if (block) this.show(block);
      else this.hide();
      return;
    }
    // The block moved or went: placed again on the next move.
    if (
      this.block &&
      this.view.state.doc.nodeAt(this.block.pos) !== this.block.node
    )
      this.hide();
  }

  destroy() {
    this.area.removeEventListener("pointerdown", this.onPress, true);
    this.area.removeEventListener("pointermove", this.onMove);
    this.area.removeEventListener("pointerleave", this.onLeave);
    this.view.dom.removeEventListener("keydown", this.hide);
    this.handle.remove();
  }
}

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
