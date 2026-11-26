import { describe, expect, it, vi } from "vitest";
import { katexLoaded } from "./katex-loader";
import { startWarming } from "../../lazy/lazy-module";

vi.mock("./katex-bundle", () => ({ default: { renderToString: () => "" } }));

describe("KaTeX before the first formula", () => {
  it("loads once the window is idle after startup", async () => {
    // Loaded only by the first document with maths, that document opened
    // to an empty sheet while it came.
    vi.useFakeTimers();
    startWarming();
    await vi.advanceTimersByTimeAsync(5000);
    vi.useRealTimers();
    await vi.waitFor(() => expect(katexLoaded()).toBe(true));
  });
});
