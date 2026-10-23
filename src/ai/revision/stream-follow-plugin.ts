import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/** How near the bottom of the page the writing may be and still count as
 *  in view - a wheel's last step short of it. */
const NEAR = 48;
/** Room kept below the writing while the page follows it. */
const BELOW = 96;
/** How long after a wheel, a key, a touch or a click a scroll is still the
 *  reader's own. */
const INTENT_MS = 800;

/** What is being written: new text still coming in, and the original a
 *  rewrite has reached (its reading cursor). */
const WRITING = ".pending-insert-typing, .pending-reading";

export const streamFollowKey = new PluginKey("textus-stream-follow");

/**
 * While Textus AI writes into the document, the page follows the writing -
 * while the reader is with it, as the chat follows a reply
 * (useFollowBottom): if they could see where it was writing when it
 * started, or scroll back to it, it is kept in view as it grows. Scrolled
 * away, the page stays where they put it.
 *
 * And it stays there: WebKit scrolls the caret back into view when the
 * text around it changes, which pulled a reader who had scrolled away
 * back to where the writing began. A scroll the reader didn't make - none
 * of their wheel, keys, touch or clicks just before - that moves the page
 * more than a screen while something is written is undone.
 */
export const streamFollowPlugin = $prose(
  () =>
    new Plugin({
      key: streamFollowKey,
      view(view) {
        return new StreamFollow(view);
      },
    }),
);

class StreamFollow {
  private live = false;
  private following = false;
  private intent = -Infinity;
  /** Where the page was last left, by the reader or by following. */
  private kept = 0;
  /** A scrollTop this set itself, so its own scroll event is not taken
   *  for the reader's. */
  private own: number | null = null;
  private frame: number | null = null;
  private scroller: HTMLElement | null = null;

  constructor(private view: EditorView) {
    window.addEventListener("keydown", this.markIntent, true);
    window.addEventListener("pointerdown", this.markIntent, true);
    window.addEventListener("pointermove", this.markDrag, true);
    window.addEventListener("touchmove", this.markIntent, {
      capture: true,
      passive: true,
    });
    window.addEventListener("wheel", this.markIntent, {
      capture: true,
      passive: true,
    });
  }

  /** A transaction may have started the writing; the frames after it,
   *  which write without one (pending-animation.ts), carry it on. */
  update() {
    if (this.live || this.view.dom.querySelector(WRITING) === null) return;
    this.live = true;
    this.start();
    this.tick();
  }

  destroy() {
    window.removeEventListener("keydown", this.markIntent, true);
    window.removeEventListener("pointerdown", this.markIntent, true);
    window.removeEventListener("pointermove", this.markDrag, true);
    window.removeEventListener("touchmove", this.markIntent, true);
    window.removeEventListener("wheel", this.markIntent, true);
    this.scroller?.removeEventListener("scroll", this.onScroll);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
  }

  private start() {
    const scroller = this.view.dom.closest<HTMLElement>(".editor-scroll");
    if (scroller !== this.scroller) {
      this.scroller?.removeEventListener("scroll", this.onScroll);
      scroller?.addEventListener("scroll", this.onScroll, { passive: true });
      this.scroller = scroller;
    }
    if (!scroller) return;
    this.kept = scroller.scrollTop;
    this.following = this.inView();
  }

  private markIntent = () => {
    this.intent = performance.now();
  };

  /** Dragging the scrollbar or a selection is the reader's too. */
  private markDrag = (e: PointerEvent) => {
    if (e.buttons) this.intent = performance.now();
  };

  /** The bottom of what is being written, in the viewport. */
  private edge(): number | null {
    let bottom: number | null = null;
    for (const el of this.view.dom.querySelectorAll(WRITING)) {
      const r = el.getBoundingClientRect();
      if (r.height > 0) bottom = Math.max(bottom ?? r.bottom, r.bottom);
    }
    return bottom;
  }

  private inView(): boolean {
    const edge = this.edge();
    if (edge === null || !this.scroller) return false;
    const r = this.scroller.getBoundingClientRect();
    return edge >= r.top && edge <= r.bottom + NEAR;
  }

  private onScroll = () => {
    const scroller = this.scroller;
    if (!scroller || !this.live) return;
    const top = scroller.scrollTop;
    if (this.own !== null && Math.abs(top - this.own) < 1) {
      this.own = null;
      this.kept = top;
      return;
    }
    const theirs = performance.now() - this.intent < INTENT_MS;
    if (!theirs && Math.abs(top - this.kept) > scroller.clientHeight) {
      this.set(this.kept);
      return;
    }
    this.kept = top;
    if (theirs) this.following = this.inView();
  };

  /** Each frame while something is written: keep it in view while
   *  following; stop once nothing is. */
  private tick = () => {
    this.frame = null;
    const edge = this.edge();
    if (edge === null && this.view.dom.querySelector(WRITING) === null) {
      this.live = false;
      return;
    }
    const scroller = this.scroller;
    if (scroller && edge !== null && this.following) {
      const over = edge - (scroller.getBoundingClientRect().bottom - BELOW);
      if (over > 0) this.set(scroller.scrollTop + over);
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private set(top: number) {
    const scroller = this.scroller!;
    this.own = Math.round(top);
    scroller.scrollTop = top;
    this.kept = scroller.scrollTop;
    if (Math.abs(scroller.scrollTop - this.own) >= 1) this.own = null;
  }
}
