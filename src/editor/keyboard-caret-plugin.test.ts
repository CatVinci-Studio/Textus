// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../platform/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isMobileApp: true,
}));

// The app's keyboard tracking, which marks the root.
await import("../mobile/keyboard");
const { closeViews, openView } = await import("./editor-view-kit");

afterEach(async () => {
  vi.useRealTimers();
  await closeViews();
});

const resize = (height: number) => {
  Object.defineProperty(window, "innerHeight", {
    value: height,
    configurable: true,
  });
  window.dispatchEvent(new Event("resize"));
};

describe("the keyboard rising", () => {
  it("brings the caret back with the editor's own scroll, and again when the page shrinks while it is up", async () => {
    const t = await openView("one\n\ntwo");
    vi.spyOn(t.view, "hasFocus").mockReturnValue(true);
    const scrolled = vi.fn();
    const dispatch = t.view.dispatch.bind(t.view);
    t.view.dispatch = (tr) => {
      if (tr.scrolledIntoView) scrolled();
      dispatch(tr);
    };
    vi.useFakeTimers();
    resize(800);
    window.dispatchEvent(new CustomEvent("textus-keyboard", { detail: 320 }));
    vi.advanceTimersByTime(300);
    expect(scrolled).toHaveBeenCalledTimes(1);
    // A suggestion bar over the keyboard.
    resize(760);
    vi.advanceTimersByTime(300);
    expect(scrolled).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new CustomEvent("textus-keyboard", { detail: 0 }));
  });
});
