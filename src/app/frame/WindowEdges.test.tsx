// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../platform/os", async (actual) => ({
  ...(await actual<typeof import("../../platform/os")>()),
  isWindowsPlatform: () => true,
}));
vi.mock("../../platform/capabilities", async (actual) => ({
  ...(await actual<typeof import("../../platform/capabilities")>()),
  hasAppMenu: true,
}));
vi.mock("../../platform/window-state", () => ({
  useWindowState: () => ({ maximized: false, fullscreen: false }),
}));

(window as Window & { __BOOT__?: unknown }).__BOOT__ = {
  settings: {},
  label: "main",
  windows10: true,
};

const { WindowOutline } = await import("./WindowEdges");

describe("Windows 10's window outline", () => {
  it("is in the first frame, known from the boot snapshot", () => {
    const { container } = render(<WindowOutline />);
    expect(container.querySelector(".window-outline")).not.toBeNull();
  });
});
