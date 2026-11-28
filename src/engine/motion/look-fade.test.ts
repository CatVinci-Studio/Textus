// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { motionAllowed } from "./motion";
import { fadeLook, lookCanFade, onSystemScheme } from "./look-fade";
import { onAppearance } from "../tokens/appearance";

// jsdom has neither view transitions nor animation: both are stood in for,
// so what is asked of the browser, and when, can be seen.
vi.mock("./motion", async (actual) => ({
  ...(await actual<typeof import("./motion")>()),
  motionAllowed: vi.fn(() => true),
}));

interface Fake {
  /** The browser has taken the old picture: the change runs. */
  picture: () => void;
  /** The fade has played out. */
  end: () => void;
  skipTransition: ReturnType<typeof vi.fn>;
}

const root = document.documentElement;
const settle = () => new Promise((done) => setTimeout(done, 0));
let fades: Fake[] = [];

function withViewTransitions() {
  document.startViewTransition = vi.fn((update?: unknown) => {
    let end = () => {};
    const finished = new Promise<void>((done) => (end = done));
    let pictured = false;
    const fake: Fake = {
      picture: () => {
        if (pictured) return;
        pictured = true;
        (update as () => void)();
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
}

/** The system's light or dark, flipped by the test. */
function systemScheme(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, run: () => void) => listeners.add(run),
    removeEventListener: (_: string, run: () => void) => listeners.delete(run),
  };
  window.matchMedia = vi.fn(() => query) as unknown as typeof matchMedia;
  return (next: boolean) => {
    dark = next;
    listeners.forEach((run) => run());
  };
}

beforeEach(() => {
  fades = [];
  withViewTransitions();
});

afterEach(async () => {
  // As a browser always does: every picture taken, every fade over.
  for (const fade of fades) {
    fade.picture();
    fade.end();
  }
  await settle();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  delete (window as { matchMedia?: unknown }).matchMedia;
  vi.mocked(motionAllowed).mockReturnValue(true);
  root.removeAttribute("data-theme");
});

describe("a change of look", () => {
  it("lands behind a picture of the old look, and clicks wait for the fade", async () => {
    const change = vi.fn();
    fadeLook(change);
    expect(change).not.toHaveBeenCalled();
    expect(root.hasAttribute("data-look-fading")).toBe(true);
    fades[0].picture();
    expect(change).toHaveBeenCalledOnce();
    expect(root.hasAttribute("data-look-fading")).toBe(true);
    fades[0].end();
    await settle();
    expect(root.hasAttribute("data-look-fading")).toBe(false);
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
    expect(root.hasAttribute("data-look-fading")).toBe(false);
  });

  it("joins a fade not yet started, and ends one running for its own", async () => {
    const order: string[] = [];
    fadeLook(() => order.push("theme"));
    fadeLook(() => order.push("dark"));
    expect(fades).toHaveLength(1);
    fades[0].picture();
    expect(order).toEqual(["theme", "dark"]);
    fadeLook(() => order.push("again"));
    expect(fades[0].skipTransition).toHaveBeenCalledOnce();
    // The first one ending leaves the second's clicks held.
    fades[0].end();
    await settle();
    expect(root.hasAttribute("data-look-fading")).toBe(true);
    fades[1].picture();
    fades[1].end();
    await settle();
    expect(root.hasAttribute("data-look-fading")).toBe(false);
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

  it("is no change of look itself", async () => {
    const heard = vi.fn();
    const stop = onAppearance(heard);
    fadeLook(() => {});
    await settle();
    expect(heard).not.toHaveBeenCalled();
    stop();
  });
});

describe("the system flipping light or dark", () => {
  it("fades a window that follows it, holding the old look for the picture", () => {
    const flip = systemScheme(false);
    const heard = vi.fn(() => root.getAttribute("data-theme"));
    const stop = onSystemScheme(heard);
    flip(true);
    // Held as it was until the picture is taken...
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(heard).not.toHaveBeenCalled();
    // ...then let go, and the listeners re-pick inside the fade.
    fades[0].picture();
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(heard).toHaveReturnedWith(null);
    stop();
  });

  it("only tells a window with its own light or dark, which doesn't change", () => {
    const flip = systemScheme(false);
    root.setAttribute("data-theme", "dark");
    const heard = vi.fn();
    const stop = onSystemScheme(heard);
    flip(true);
    expect(heard).toHaveBeenCalledOnce();
    expect(fades).toHaveLength(0);
    expect(root.getAttribute("data-theme")).toBe("dark");
    stop();
  });
});
