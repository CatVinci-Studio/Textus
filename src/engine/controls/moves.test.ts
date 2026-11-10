// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  MARK_CLASS,
  beatElapsed,
  crossfade,
  enter,
  exit,
  joinBeat,
  land,
  startBeat,
} from "./moves";

// jsdom computes no animation, so motionAllowed() is false here: every
// move must end at once in its final state.
describe("moves where nothing moves", () => {
  it("enter starts nothing and exit resolves at once", async () => {
    const el = document.createElement("div");
    expect(enter(el)).toBeNull();
    await expect(exit(el)).resolves.toBeUndefined();
  });

  it("land makes the change at once, with no mark left behind", async () => {
    const old = document.createElement("span");
    const added = document.createElement("span");
    const change = vi.fn(() => [added]);
    await land([old], change);
    expect(change).toHaveBeenCalledOnce();
    expect(old.classList.contains(MARK_CLASS)).toBe(false);
  });
});

describe("beats", () => {
  it("tells how far into a beat it is, and nothing for one not started", () => {
    startBeat("rev:a:0", 1000);
    expect(beatElapsed("rev:a:0", 1120)).toBe(120);
    expect(beatElapsed("rev:b:0", 1120)).toBeNull();
  });

  it("forgets a beat long over", () => {
    startBeat("old", 0);
    startBeat("new", 10_000);
    expect(beatElapsed("old", 10_000)).toBeNull();
  });

  it("leaves a card's own entrance alone where nothing moves", () => {
    startBeat("rev:c:0");
    const card = document.createElement("div");
    joinBeat(card, "rev:c:0");
    expect(card.style.animationDelay).toBe("");
  });
});

describe("crossfade where nothing moves", () => {
  it("makes the change at once and leaves no copies behind", () => {
    const parent = document.createElement("div");
    const root = document.createElement("div");
    const p = document.createElement("p");
    root.append(p);
    parent.append(root);
    const change = vi.fn(() => p.replaceWith(document.createElement("p")));
    crossfade(root, [p, p], change);
    expect(change).toHaveBeenCalledOnce();
    expect(parent.children).toHaveLength(1);
  });
});
