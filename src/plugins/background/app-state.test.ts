// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ mobile: false }));
const told = vi.hoisted(() => [] as unknown[]);
vi.mock("../../platform/capabilities", () => ({
  get isMobileApp() {
    return platform.mobile;
  },
}));
vi.mock("../../platform/ipc-schedule", () => ({
  schedule: { appState: async () => "inactive" },
}));
vi.mock("../../platform/events", () => ({
  listenToThisWindow: () => Promise.resolve(() => {}),
  unlistenAll: () => () => {},
}));
vi.mock("../app-bridge", () => ({
  emitPluginEvent: (name: string, state: unknown) => told.push([name, state]),
}));

let hidden = false;
Object.defineProperty(document, "visibilityState", {
  configurable: true,
  get: () => (hidden ? "hidden" : "visible"),
});
const turn = (to: "hidden" | "visible") => {
  hidden = to === "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
};

async function watching(mobile: boolean) {
  platform.mobile = mobile;
  vi.resetModules();
  const m = await import("./app-state");
  const stop = m.watchAppState();
  await Promise.resolve();
  return { state: m.currentAppState, stop };
}

afterEach(() => {
  hidden = false;
  told.length = 0;
});

describe("textus.app.state", () => {
  it("on a phone, follows the app to the background and back", async () => {
    const { state, stop } = await watching(true);
    expect(state()).toBe("active");
    turn("hidden");
    expect(state()).toBe("background");
    turn("visible");
    expect(state()).toBe("active");
    expect(told).toEqual([
      ["appState", "background"],
      ["appState", "active"],
    ]);
    stop();
    turn("hidden");
    expect(state()).toBe("active");
  });

  it("on a phone opened in the background, starts there", async () => {
    hidden = true;
    const { state } = await watching(true);
    expect(state()).toBe("background");
  });

  it("on the desktop, is Rust's, whatever the page's visibility", async () => {
    const { state } = await watching(false);
    expect(state()).toBe("inactive");
    turn("hidden");
    expect(state()).toBe("inactive");
  });
});
