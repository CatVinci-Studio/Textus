// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../motion/motion", () => ({
  motionAllowed: () => true,
  animate: (el: Element, frames: Keyframe[]) => el.animate(frames),
}));
vi.mock("../../platform/os", () => ({ isMacPlatform: () => true }));
vi.mock("../../platform/capabilities", () => ({ isIOSApp: false }));
// The native side's word of the finger (trackpad.rs), told by each test.
const touch = vi.hoisted(() => ({
  down: null as boolean | null,
  heard: new Set<(down: boolean) => void>(),
}));
vi.mock("../../platform/trackpad", () => ({
  fingerDown: () => touch.down,
  onTrackpadTouch: (listener: (down: boolean) => void) => {
    touch.heard.add(listener);
    return () => touch.heard.delete(listener);
  },
}));
const finger = (down: boolean) => {
  touch.down = down;
  for (const listener of touch.heard) listener(down);
};

import { elasticOverscroll } from "./elastic-overscroll";

/** A document's scroll box at its top, with the springs it plays. */
function page() {
  const scroller = document.createElement("div");
  const content = document.createElement("div");
  scroller.append(content);
  Object.defineProperty(scroller, "clientHeight", { value: 500 });
  Object.defineProperty(scroller, "scrollHeight", { value: 2000 });
  // Each spring played, and how to end it.
  const springs: { frames: Keyframe[]; done?: () => void }[] = [];
  content.animate = ((frames: Keyframe[]) => {
    const spring = { frames } as (typeof springs)[number];
    springs.push(spring);
    const anim = {
      cancel() {
        anim.oncancel?.(new Event("cancel") as AnimationPlaybackEvent);
      },
    } as Animation;
    spring.done = () =>
      anim.onfinish?.(new Event("finish") as AnimationPlaybackEvent);
    return anim;
  }) as typeof content.animate;
  const stop = elasticOverscroll(scroller, content);
  return { scroller, content, springs, stop };
}

const wheel = (el: HTMLElement, deltaY: number) =>
  el.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaMode: 0 }));

/** One wheel event every frame, as a trackpad sends them. */
function swipe(el: HTMLElement, deltas: number[]) {
  for (const d of deltas) {
    wheel(el, d);
    vi.advanceTimersByTime(16);
  }
}

describe("the Mac's give at a document's end", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    touch.down = null;
  });

  it("pulls the text after the finger past the top, the box marked stretched until it rests", () => {
    const { scroller, content, springs, stop } = page();
    const scrolls = vi.fn();
    scroller.addEventListener("scroll", scrolls);
    swipe(scroller, [-8, -9, -8, -10, -8]);
    expect(content.style.translate).toMatch(/^0 \d/);
    expect(scroller.hasAttribute("data-stretched")).toBe(true);
    finger(false);
    // Springing back, still stretched; at rest, a scroll is heard.
    expect(springs).toHaveLength(1);
    expect(scroller.hasAttribute("data-stretched")).toBe(true);
    expect(scrolls).not.toHaveBeenCalled();
    springs.at(-1)!.done!();
    expect(scroller.hasAttribute("data-stretched")).toBe(false);
    expect(scrolls).toHaveBeenCalledOnce();
    stop();
  });

  it("springs back as soon as the finger lifts, not when the coasting ends", () => {
    const { scroller, content, springs, stop } = page();
    swipe(scroller, [-8, -9, -8, -10, -8, -9]);
    // The finger is off; macOS keeps sending the swipe's momentum, smaller
    // each frame, for most of a second.
    swipe(scroller, [-8, -7, -6, -5, -4]);
    expect(springs).toHaveLength(1);
    expect(content.style.translate).toBe("");
    // The rest of the coasting doesn't pull it out again.
    swipe(scroller, [-3, -3, -2, -2, -1, -1, -1]);
    expect(content.style.translate).toBe("");
    expect(springs).toHaveLength(1);
    stop();
  });

  it("holds the pull while the finger rests, and lets go once it is lifted", () => {
    const { scroller, content, springs, stop } = page();
    swipe(scroller, [-8, -9, -8, -10, -8]);
    const held = content.style.translate;
    // The finger stops, still down: nothing comes for a moment.
    vi.advanceTimersByTime(300);
    expect(content.style.translate).toBe(held);
    expect(springs).toHaveLength(0);
    // It moves on, and the pull goes on from where it was.
    swipe(scroller, [-8, -9]);
    expect(parseFloat(content.style.translate.split(" ")[1])).toBeGreaterThan(
      parseFloat(held.split(" ")[1]),
    );
    // Lifted without moving: it springs back.
    vi.advanceTimersByTime(500);
    expect(content.style.translate).toBe("");
    expect(springs).toHaveLength(1);
    stop();
  });

  it("told of the finger, holds a still pull until it lifts, then springs back at once", () => {
    const { scroller, content, springs, stop } = page();
    finger(true);
    swipe(scroller, [-8, -9, -8, -10, -8]);
    const held = content.style.translate;
    // Held still well past any pause a guess would take for a lift.
    vi.advanceTimersByTime(2000);
    expect(content.style.translate).toBe(held);
    expect(springs).toHaveLength(0);
    // Lifted: back now, not after a wait.
    finger(false);
    expect(content.style.translate).toBe("");
    expect(springs).toHaveLength(1);
    // The momentum comes after a pause, as a new swipe would: it doesn't
    // pull the page out again.
    vi.advanceTimersByTime(120);
    swipe(scroller, [-12, -11, -10, -9, -8, -7, -6]);
    expect(content.style.translate).toBe("");
    expect(springs).toHaveLength(1);
    stop();
  });

  it("gives again on the next swipe", () => {
    const { scroller, content, stop } = page();
    swipe(scroller, [-8, -9, -8, -7, -6, -5, -4, -3]);
    vi.advanceTimersByTime(300);
    swipe(scroller, [-8, -9, -8]);
    expect(content.style.translate).toMatch(/^0 \d/);
    stop();
  });

  it("keeps pulling while the finger slows unevenly", () => {
    const { scroller, content, stop } = page();
    swipe(scroller, [-8, -9, -8, -10]);
    swipe(scroller, [-1, -1, -2, -1, -1]);
    expect(content.style.translate).toMatch(/^0 \d/);
    stop();
  });

  it("bounces once when a swipe's momentum runs into the top", () => {
    const { scroller, content, springs, stop } = page();
    let top = 300;
    Object.defineProperty(scroller, "scrollTop", { get: () => top });
    swipe(scroller, [-20, -22, -20, -18, -16, -14]);
    top = 0;
    swipe(scroller, [-12, -10, -8, -6, -4, -2]);
    expect(springs).toHaveLength(1);
    expect(content.style.translate).toBe("");
    stop();
  });

  it("bounces as a fast flick arrives at the top, not once it has slowed", () => {
    const { scroller, springs, stop } = page();
    let top = 900;
    Object.defineProperty(scroller, "scrollTop", { get: () => top });
    swipe(scroller, [-150, -140, -130, -120, -110, -100]);
    top = 0;
    swipe(scroller, [-90]);
    expect(springs).toHaveLength(1);
    stop();
  });

  it("takes a new pull up from where the spring back is, without a jump", () => {
    const { scroller, content, stop } = page();
    swipe(scroller, [-8, -9, -8, -10, -8]);
    vi.advanceTimersByTime(500);
    expect(content.style.translate).toBe("");
    // Half way back when the finger pulls again.
    const real = window.getComputedStyle;
    window.getComputedStyle = ((el: Element) =>
      el === content
        ? ({ translate: "0px 20px" } as CSSStyleDeclaration)
        : real(el)) as typeof window.getComputedStyle;
    swipe(scroller, [-1]);
    window.getComputedStyle = real;
    const y = parseFloat(content.style.translate.split(" ")[1]);
    expect(y).toBeGreaterThan(20);
    expect(y).toBeLessThan(22);
    stop();
  });
});
