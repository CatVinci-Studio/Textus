import { describe, expect, it, vi } from "vitest";
import { lazyModule, loadedModules, startWarming } from "./lazy-module";

describe("lazyModule", () => {
  it("loads on first use, once, and says so", async () => {
    const loader = vi.fn(async () => ({ value: 1 }));
    const mod = lazyModule("test:once", loader);
    expect(loader).not.toHaveBeenCalled();
    expect(mod.peek()).toBeUndefined();
    expect(loadedModules()).not.toContain("test:once");
    const [a, b] = await Promise.all([mod.load(), mod.load()]);
    expect(a).toBe(b);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(mod.peek()).toEqual({ value: 1 });
    expect(loadedModules()).toContain("test:once");
  });

  it("tries again after a failed load", async () => {
    let calls = 0;
    const mod = lazyModule("test:retry", async () => {
      if (++calls === 1) throw new Error("offline");
      return "ok";
    });
    await expect(mod.load()).rejects.toThrow("offline");
    expect(await mod.load()).toBe("ok");
  });

  it("forgets a dropped module", async () => {
    const mod = lazyModule("test:drop", async () => 1);
    await mod.load();
    mod.drop();
    expect(loadedModules()).not.toContain("test:drop");
  });

  it("warms a warm module once the window is idle, not before", async () => {
    vi.useFakeTimers();
    const loader = vi.fn(async () => 1);
    lazyModule("test:warm", loader, { warm: true });
    const cold = vi.fn(async () => 2);
    lazyModule("test:cold", cold);
    await vi.advanceTimersByTimeAsync(5000);
    expect(loader).not.toHaveBeenCalled();
    startWarming();
    await vi.advanceTimersByTimeAsync(5000);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cold).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
