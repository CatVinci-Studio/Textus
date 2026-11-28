// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { carryLook, readLook } from "./carry";

/** A stylesheet animation on `el` whose opacity at each moment is
 *  `opacity(t)`, drawn into the element's style as a browser would. */
function animation(
  el: HTMLElement,
  end: number,
  opacity: (t: number) => number,
  state = "running",
) {
  let time = 0;
  const anim = {
    animationName: "motion-test",
    playState: state,
    effect: {
      target: el,
      pseudoElement: null,
      getComputedTiming: () => ({ endTime: end }),
    },
    get currentTime() {
      return time;
    },
    set currentTime(t: number) {
      time = t;
      el.style.opacity = String(opacity(Math.min(t / end, 1)));
    },
  };
  anim.currentTime = 0;
  return anim as unknown as Animation;
}

/** Gives each element the animations `of` names for it, and the root its
 *  subtree's. */
function animate(root: HTMLElement, of: Map<Element, Animation[]>) {
  for (const el of [root, ...root.querySelectorAll("*")])
    (el as unknown as { getAnimations: unknown }).getAnimations = (
      options?: GetAnimationsOptions,
    ) =>
      options?.subtree
        ? [...of].filter(([at]) => el.contains(at)).flatMap(([, a]) => a)
        : (of.get(el) ?? []);
}

afterEach(() => document.body.replaceChildren());

function surface() {
  const root = document.createElement("div");
  root.append(document.createElement("div"));
  document.body.append(root);
  return { root, card: root.firstElementChild as HTMLElement };
}

describe("readLook", () => {
  it("is empty for a surface at rest", () => {
    const { root } = surface();
    animate(root, new Map());
    expect(readLook(root)).toEqual([]);
  });

  it("reads each moving part by its place in the surface", () => {
    const { root, card } = surface();
    const back = animation(root, 120, (p) => p);
    const front = animation(card, 120, (p) => p);
    back.currentTime = 30;
    front.currentTime = 60;
    animate(
      root,
      new Map([
        [root, [back]],
        [card, [front]],
      ]),
    );
    expect(readLook(root)).toEqual([
      [[], 0.25],
      [[0], 0.5],
    ]);
  });
});

describe("carryLook", () => {
  it("starts an exit from how far the entrance had got, not from full", () => {
    const { root } = surface();
    const exit = animation(root, 80, (p) => 1 - p);
    animate(root, new Map([[root, [exit]]]));
    carryLook(root, [[[], 0.4]]);
    expect(exit.currentTime).toBeGreaterThan(45);
    expect(exit.currentTime).toBeLessThan(51);
    expect(parseFloat(root.style.opacity)).toBeCloseTo(0.4, 1);
  });

  it("starts an entrance again from how far the exit had faded, not from nothing", () => {
    const { root, card } = surface();
    const entrance = animation(card, 120, (p) => p * p);
    animate(root, new Map([[card, [entrance]]]));
    carryLook(root, [[[0], 0.64]]);
    expect(parseFloat(card.style.opacity)).toBeCloseTo(0.64, 1);
  });

  it("leaves alone a move already showing that look, or one that never fades", () => {
    const { root, card } = surface();
    const fresh = animation(root, 120, (p) => p);
    const still = animation(card, 120, () => 1);
    animate(
      root,
      new Map([
        [root, [fresh]],
        [card, [still]],
      ]),
    );
    carryLook(root, [
      [[], 0],
      [[0], 0.3],
    ]);
    expect(fresh.currentTime).toBe(0);
    expect(still.currentTime).toBe(0);
  });
});
