// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsProvider } from "../../prefs/SettingsContext";
import { MenuBar } from "./MenuBar";

vi.mock("./app-menu-lazy", () => ({ AppMenu: () => null }));

describe("the menu bar", () => {
  afterEach(cleanup);

  function titles() {
    render(
      <SettingsProvider>
        <MenuBar />
      </SettingsProvider>,
    );
    return screen.getAllByRole("menuitem");
  }
  const press = (el: Element, init: object = {}) =>
    fireEvent.pointerDown(el, {
      pointerType: "mouse",
      button: 0,
      clientX: 5,
      clientY: 5,
      ...init,
    });

  it("opens a title's list on the mouse's press, and the click of that press does not close it", () => {
    const [first] = titles();
    press(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(first, { detail: 1 });
    expect(first.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes it when pressed again", () => {
    const [first] = titles();
    press(first);
    fireEvent.click(first, { detail: 1 });
    press(first);
    expect(first.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens on the click for a finger, the keys and a right press", () => {
    const [first, second] = titles();
    press(first, { pointerType: "touch" });
    expect(first.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(first, { detail: 1 });
    expect(first.getAttribute("aria-expanded")).toBe("true");
    press(second, { button: 2 });
    expect(second.getAttribute("aria-expanded")).toBe("false");
  });

  it("moves to another title the pointer enters while a list is open", () => {
    const [first, second] = titles();
    press(first);
    fireEvent.mouseEnter(second);
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(second.getAttribute("aria-expanded")).toBe("true");
  });
});
