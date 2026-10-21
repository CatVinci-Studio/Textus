// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ui/motion", () => ({ motionAllowed: () => true }));

import { elasticOverscroll } from "./elastic-overscroll";

/** A document's scroll box at its top, with the springs it plays. */
function page() {
  const scroller = document.createElement("div");
  const content = document.createElement("div");
  scroller.append(content);
  Object.defineProperty(scroller, "clientHeight", { value: 500 });
  Object.defineProperty(scroller, "scrollHeight", { value: 2000 });
  const springs: Keyframe[][] = [];
  content.animate = ((frames: Keyframe[]) => {
    springs.push(frames);
    return { cancel() {} } as Animation;
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
  afterEach(() => vi.useRealTimers());

  it("pulls the text after the finger past the top", () => {
    const { scroller, content, stop } = page();
    swipe(scroller, [-8, -9, -8, -10, -8]);
    expect(content.style.translate).toMatch(/^0 \d/);
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
});
