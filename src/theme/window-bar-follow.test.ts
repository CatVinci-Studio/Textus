// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const follow = vi.fn(() => Promise.resolve());
const tokenPx = vi.fn<(name: string) => number>();
vi.mock("../platform/ipc", async (load) => ({
  ...(await load<typeof import("../platform/ipc")>()),
  windowBarIpc: { follow, setTitle: vi.fn() },
}));
vi.mock("../engine/tokens/token-px", () => ({ tokenPx }));

const { followWindowBar } = await import("./apply-appearance");

describe("followWindowBar", () => {
  afterEach(() => {
    follow.mockClear();
    document.documentElement.style.removeProperty("--window-bar-height");
  });

  it("sends the bar's height resolved, not its calc() text", () => {
    document.documentElement.style.setProperty(
      "--window-bar-height",
      "calc(var(--safe-top, 0px) + var(--window-bar-row))",
    );
    tokenPx.mockReturnValue(40);
    followWindowBar();
    expect(tokenPx).toHaveBeenCalledWith("--window-bar-height", {
      fresh: true,
    });
    expect(follow).toHaveBeenCalledWith(40);
  });

  it("sends nothing before the bar is laid out", () => {
    tokenPx.mockReturnValue(0);
    followWindowBar();
    expect(follow).not.toHaveBeenCalled();
  });
});
