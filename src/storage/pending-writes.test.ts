// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flushPendingWrites,
  flushWhenHidden,
  onFlush,
  onWriteFailed,
  resetPendingWritesForTests,
  trackWrite,
} from "./pending-writes";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  resetPendingWritesForTests();
  vi.useRealTimers();
});

describe("flushPendingWrites", () => {
  it("resolves at once with nothing in flight", async () => {
    await expect(flushPendingWrites()).resolves.toBeUndefined();
  });

  it("sends held-back writes synchronously, before it first waits", () => {
    const send = vi.fn();
    onFlush(send);
    void flushPendingWrites();
    // A caller that can't wait (a window about to be destroyed) still got
    // them on their way.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("waits for every write in flight, failed ones included", async () => {
    const a = deferred();
    const b = deferred();
    trackWrite(a.promise);
    trackWrite(b.promise).catch(() => {});
    let done = false;
    void flushPendingWrites().then(() => (done = true));
    a.resolve();
    await tick();
    expect(done).toBe(false);
    b.reject(new Error("ipc"));
    await tick();
    expect(done).toBe(true);
  });

  it("tells a failed write to who asked, as well as to its caller", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = vi.fn();
    const stop = onWriteFailed(failed);
    const write = trackWrite(Promise.reject(new Error("disk full")));
    await expect(write).rejects.toThrow("disk full");
    await tick();
    expect(failed).toHaveBeenCalledTimes(1);
    stop();
    await trackWrite(Promise.reject(new Error("again"))).catch(() => {});
    await tick();
    expect(failed).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("waits for a write a held-back one starts, too", async () => {
    const write = deferred();
    onFlush(() => {
      trackWrite(write.promise);
    });
    let done = false;
    void flushPendingWrites().then(() => (done = true));
    await tick();
    expect(done).toBe(false);
    write.resolve();
    await tick();
    expect(done).toBe(true);
  });

  it("gives up after the timeout rather than keep a window open", async () => {
    vi.useFakeTimers();
    trackWrite(new Promise(() => {}));
    let done = false;
    void flushPendingWrites(500).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("forgets a write once it has settled", async () => {
    const write = deferred();
    trackWrite(write.promise);
    write.resolve();
    await tick();
    vi.useFakeTimers();
    let done = false;
    void flushPendingWrites(10_000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });
});

describe("flushWhenHidden", () => {
  function hide(state: DocumentVisibilityState) {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue(state);
    document.dispatchEvent(new Event("visibilitychange"));
    visibility.mockRestore();
  }

  it("sends held-back writes when iOS sends the app to the background", () => {
    flushWhenHidden();
    flushWhenHidden(); // a second call adds no second listener
    const send = vi.fn();
    onFlush(send);
    hide("visible");
    expect(send).not.toHaveBeenCalled();
    hide("hidden");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends them when the page unloads, too", () => {
    flushWhenHidden();
    const send = vi.fn();
    onFlush(send);
    window.dispatchEvent(new Event("pagehide"));
    expect(send).toHaveBeenCalledTimes(1);
  });
});
