import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { duration, length, motionAllowed } from "../../ui/motion";

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

/** The page follows AI writing while the reader is with it. A scroll they
 *  didn't make of over a screen is undone, as WebKit pulls the caret back. */
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
    window.addEventListener("touchmove", this.letGo, {
      capture: true,
      passive: true,
    });
    window.addEventListener("wheel", this.letGo, {
      capture: true,
      passive: true,
    });
  }

  /** A transaction may have started the writing; the frames after it,
   *  which write without one, carry it on. */
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
    window.removeEventListener("touchmove", this.letGo, true);
    window.removeEventListener("wheel", this.letGo, true);
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

  /** No following until the reader's scroll lands, or a frame in between
   *  would set the page back and cut smooth scrolling short. */
  private letGo = () => {
    this.intent = performance.now();
    this.following = false;
    this.speed = 0;
  };

  /** How far a frame of following goes: a critically damped spring, so the
   *  page settles without overshoot. Under reduced motion, all at once. */
  private glide(over: number, dt: number): number {
    if (over <= 0) {
      this.speed = 0;
      return 0;
    }
    if (!motionAllowed()) return over;
    const omega = 4 / (duration("--dur-slow") / 1000);
    const s = dt / 1000;
    const pull = (omega * omega * over - 2 * omega * this.speed) * s;
    // Picking up no more than a short distance of speed a frame: many
    // blocks landing at once still start the page gently.
    const most = length("--motion-distance-sm") / (1 / 60);
    this.speed += Math.min(pull, most * (dt / (1000 / 60)));
    return Math.min(over, Math.max(0, this.speed * s));
  }

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
    // Up is away from the writing, however near it still is; down to it
    // takes it up again.
    if (theirs) this.following = top >= this.kept && this.inView();
    this.kept = top;
  };

  /** The last frame's time, for how far a frame's glide goes. */
  private lastFrame = 0;
  /** How fast the page is gliding after the writing, px/s. */
  private speed = 0;

  private tick = (now: number = performance.now()) => {
    this.frame = null;
    const dt = this.lastFrame ? Math.min(now - this.lastFrame, 64) : 16;
    this.lastFrame = now;
    const edge = this.edge();
    if (edge === null && this.view.dom.querySelector(WRITING) === null) {
      this.live = false;
      this.lastFrame = 0;
      this.speed = 0;
      return;
    }
    const scroller = this.scroller;
    if (scroller && edge !== null && this.following) {
      const over = edge - (scroller.getBoundingClientRect().bottom - BELOW);
      const step = this.glide(over, dt);
      if (step > 0) this.set(scroller.scrollTop + step);
    } else {
      this.speed = 0;
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
