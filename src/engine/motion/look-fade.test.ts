// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { motionAllowed } from "./motion";
import { fadeLook, holdLook, lookCanFade } from "./look-fade";

// jsdom has neither view transitions nor animation: both are stood in for,
// so what is asked of the browser, and when, can be seen.
vi.mock("./motion", async (actual) => ({
  ...(await actual<typeof import("./motion")>()),
  motionAllowed: vi.fn(() => true),
}));

interface Fake {
  /** The browser takes the old picture and runs the change: what the
   *  callback returned, which the picture waits for. */
  picture: () => unknown;
  /** The fade has played out. */
  end: () => void;
  skipTransition: ReturnType<typeof vi.fn>;
}

const settle = () => new Promise((done) => setTimeout(done, 0));
let fades: Fake[] = [];

beforeEach(() => {
  fades = [];
  document.startViewTransition = vi.fn((update?: unknown) => {
    let end = () => {};
    const finished = new Promise<void>((done) => (end = done));
    let pictured = false;
    const fake: Fake = {
      picture: () => {
        if (pictured) return;
        pictured = true;
        return (update as () => unknown)();
      },
      end,
      skipTransition: vi.fn(),
    };
    fades.push(fake);
    return {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished,
      skipTransition: fake.skipTransition,
    } as unknown as ViewTransition;
  }) as typeof document.startViewTransition;
});

afterEach(async () => {
  vi.useRealTimers();
  // As a browser always does: every picture taken, every fade over.
  for (const fade of fades) {
    fade.picture();
    fade.end();
  }
  await settle();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  vi.mocked(motionAllowed).mockReturnValue(true);
});

describe("a change of look", () => {
  it("lands behind a picture of the old look", () => {
    const change = vi.fn();
    fadeLook(change);
    expect(change).not.toHaveBeenCalled();
    expect(fades[0].picture()).toBeUndefined();
    expect(change).toHaveBeenCalledOnce();
  });

  it("lands at once, as before, without view transitions or under reduced motion", () => {
    const change = vi.fn();
    vi.mocked(motionAllowed).mockReturnValue(false);
    fadeLook(change);
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    vi.mocked(motionAllowed).mockReturnValue(true);
    fadeLook(change);
    expect(change).toHaveBeenCalledTimes(2);
    expect(fades).toHaveLength(0);
  });

  it("joins a fade not yet started, and ends one running for its own", () => {
    const order: string[] = [];
    fadeLook(() => order.push("theme"));
    fadeLook(() => order.push("dark"));
    expect(fades).toHaveLength(1);
    fades[0].picture();
    expect(order).toEqual(["theme", "dark"]);
    fadeLook(() => order.push("again"));
    expect(fades[0].skipTransition).toHaveBeenCalledOnce();
    fades[1].picture();
    expect(order).toEqual(["theme", "dark", "again"]);
  });

  it("makes a change asked for inside a fade's own at once", () => {
    const inner = vi.fn();
    fadeLook(() => {
      expect(lookCanFade()).toBe(false);
      fadeLook(inner);
      expect(inner).toHaveBeenCalledOnce();
    });
    fades[0].picture();
    expect(fades).toHaveLength(1);
  });
});

describe("a change still loading what it shows", () => {
  it("keeps the old picture until it has come", async () => {
    let loaded = () => {};
    fadeLook(() => holdLook(new Promise<void>((done) => (loaded = done))));
    const waits = fades[0].picture() as Promise<void>;
    const done = vi.fn();
    void waits.then(done);
    await settle();
    expect(done).not.toHaveBeenCalled();
    loaded();
    await settle();
    expect(done).toHaveBeenCalledOnce();
  });

  it("keeps it no longer than --dur-slow", async () => {
    vi.useFakeTimers();
    fadeLook(() => holdLook(new Promise(() => {})));
    const done = vi.fn();
    void (fades[0].picture() as Promise<void>).then(done);
    await vi.advanceTimersByTimeAsync(300);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(done).toHaveBeenCalledOnce();
  });

  it("holds nothing outside a fade", () => {
    expect(() => holdLook(new Promise(() => {}))).not.toThrow();
  });
});
