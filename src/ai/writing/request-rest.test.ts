import { afterEach, describe, expect, it, vi } from "vitest";
import { requestRest } from "./request-rest";

afterEach(() => vi.useRealTimers());

describe("a writing aid after a failed request", () => {
  it("rests a while and logs the failure once", () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const rest = requestRest("aid", 1000);
    expect(rest.resting()).toBe(false);
    rest.failed(new Error("no provider"));
    rest.failed(new Error("no provider"));
    expect(rest.resting()).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1001);
    expect(rest.resting()).toBe(false);
    log.mockRestore();
  });
});
