import { afterEach, describe, expect, it } from "vitest";
import {
  addHoverProvider,
  hasHoverProviders,
  provideHover,
  removeHoverProvider,
  setHoverStarter,
} from "./hover-providers";

afterEach(() => {
  removeHoverProvider("test.cards");
  setHoverStarter(0, null);
});

describe("hover cards from plugins", () => {
  it("start a plugin waiting for the first hover, and ask it then", async () => {
    let started = 0;
    setHoverStarter(1, async () => {
      started++;
      setHoverStarter(0, null);
      addHoverProvider("test.cards", async (target) =>
        target.type === "link" ? { title: "A", markdown: target.url } : null,
      );
    });
    // Waiting counts: the editor asks on a hover at all.
    expect(hasHoverProviders()).toBe(true);
    expect(started).toBe(0);
    const card = await provideHover({ type: "link", url: "https://a.b" });
    expect(card).toEqual({ title: "A", markdown: "https://a.b" });
    expect(started).toBe(1);
    await provideHover({ type: "link", url: "https://c.d" });
    expect(started).toBe(1);
  });

  it("ask none when no plugin gives cards or waits to", () => {
    expect(hasHoverProviders()).toBe(false);
  });
});
