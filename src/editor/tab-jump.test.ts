import { describe, expect, it, vi } from "vitest";
import { onTabJump, setTabJump, takeTabJump } from "./tab-jump";

describe("tab jumps", () => {
  it("is taken once, by the tab it was left for", () => {
    setTabJump("a", { kind: "heading", anchor: "intro" });
    expect(takeTabJump("b")).toBeNull();
    expect(takeTabJump("a")).toEqual({ kind: "heading", anchor: "intro" });
    expect(takeTabJump("a")).toBeNull();
  });

  it("replaces a jump that wasn't taken yet", () => {
    setTabJump("a", { kind: "heading", anchor: "one" });
    setTabJump("a", { kind: "heading", anchor: "two" });
    expect(takeTabJump("a")).toEqual({ kind: "heading", anchor: "two" });
  });

  it("tells a mounted editor only when asked to jump now", () => {
    const listener = vi.fn();
    const stop = onTabJump(listener);
    setTabJump("a", { kind: "heading", anchor: "later" });
    expect(listener).not.toHaveBeenCalled();
    setTabJump("a", { kind: "heading", anchor: "now" }, true);
    expect(listener).toHaveBeenCalledWith("a");
    stop();
    takeTabJump("a");
  });
});
