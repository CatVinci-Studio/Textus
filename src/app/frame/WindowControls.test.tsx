// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsProvider } from "../../prefs/SettingsContext";
import { AppMenuButton } from "./WindowControls";

vi.mock("../menu/app-menu-lazy", () => ({ AppMenu: () => null }));
vi.mock("../../platform/window-chrome", () => ({
  appDrawsWindowFrame: true,
}));

describe("the window's Menu button", () => {
  afterEach(cleanup);

  function button() {
    render(
      <SettingsProvider>
        <AppMenuButton />
      </SettingsProvider>,
    );
    return screen.getByRole("button", { expanded: false });
  }
  const press = (el: Element, init: object = {}) =>
    fireEvent.pointerDown(el, { pointerType: "mouse", button: 0, ...init });

  it("opens on the mouse's press; its click does not close it, a second press does", () => {
    const menu = button();
    press(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(menu, { detail: 1 });
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    press(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens on the click for the keys and a finger", () => {
    const menu = button();
    press(menu, { pointerType: "touch" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(menu, { detail: 0 });
    expect(menu.getAttribute("aria-expanded")).toBe("true");
  });
});
