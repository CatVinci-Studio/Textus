// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("../platform/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isMobileApp: true,
}));

await import("./keyboard");
const { KEYBOARD_UP_EVENT } = await import("../utils/events");

const say = (px: number) =>
  window.dispatchEvent(new CustomEvent("textus-keyboard", { detail: px }));

describe("the keyboard coming up", () => {
  it("is told once each time it comes up, not while it stays", () => {
    const risen = vi.fn();
    window.addEventListener(KEYBOARD_UP_EVENT, risen);
    say(320);
    say(330);
    expect(risen).toHaveBeenCalledTimes(1);
    say(0);
    say(320);
    expect(risen).toHaveBeenCalledTimes(2);
    window.removeEventListener(KEYBOARD_UP_EVENT, risen);
  });
});
