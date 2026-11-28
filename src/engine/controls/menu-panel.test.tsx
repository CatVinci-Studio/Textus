// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { menuHost } from "./menu-panel";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { Presence } from "../motion/usePresence";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
});

const dialog = (modal: boolean) => {
  const el = document.createElement("div");
  el.setAttribute("role", "dialog");
  if (modal) el.setAttribute("aria-modal", "true");
  const button = document.createElement("button");
  el.append(button);
  document.body.append(el);
  return { el, button };
};

it("a menu goes where its opener is, not into a floating view open elsewhere", () => {
  const settings = dialog(true);
  const pet = dialog(false);
  // Opened from the page: on the page, not in the pet's view.
  settings.el.remove();
  expect(menuHost()).toBe(document.body);
  // Opened in Settings while the pet is up: in Settings.
  document.body.prepend(settings.el);
  settings.button.focus();
  expect(menuHost()).toBe(settings.el);
  // Nothing focused, a modal open: in the modal.
  settings.button.blur();
  expect(menuHost()).toBe(settings.el);
  // Opened in the pet's own view: there.
  pet.button.focus();
  expect(menuHost()).toBe(pet.el);
  // By its button, wherever the focus is (WebKit doesn't focus a pressed
  // button).
  expect(menuHost(settings.button)).toBe(settings.el);
});

const items = (onSelect = vi.fn()): ContextMenuEntry[] => [
  { label: "Plain", onSelect },
  { label: "More", items: [{ label: "Inner", onSelect }] },
];

function Menu({
  show = true,
  anchor,
  keyboard,
  onClose = () => {},
}: {
  show?: boolean;
  anchor?: HTMLElement;
  keyboard?: boolean;
  onClose?: () => void;
}) {
  return (
    <Presence show={show}>
      {show && (
        <ContextMenu
          x={10}
          y={10}
          items={items()}
          anchor={anchor}
          keyboard={keyboard}
          onClose={onClose}
        />
      )}
    </Presence>
  );
}

const row = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(
    (el) => el.textContent === name,
  )!;
const submenu = () => document.querySelector<HTMLElement>(".context-submenu");

/** Exits that keep running until the test ends them (jsdom plays no CSS). */
function withExits() {
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value(this: HTMLElement) {
      if (this.dataset.state !== "closing") return [];
      return [
        {
          playState: "running",
          effect: { getComputedTiming: () => ({ endTime: 80 }) },
          finished: new Promise(() => {}),
        },
      ];
    },
  });
}

/** A fixed on-screen box for an element jsdom lays out at 0. */
function at(el: Element, top: number, left = 0, width = 200, height = 30) {
  el.getBoundingClientRect = () =>
    ({
      top,
      left,
      width,
      height,
      bottom: top + height,
      right: left + width,
    }) as DOMRect;
}

describe("submenus", () => {
  it("open in the floating view their menu is in", () => {
    const pet = dialog(false);
    render(<Menu anchor={pet.button} />);
    fireEvent.mouseEnter(row("More"));
    // The focus is on the page: only the row says where the menu is.
    expect(submenu()).not.toBeNull();
    expect(pet.el).toContainElement(submenu());
  });

  it("play their exit, and the menu its own", () => {
    withExits();
    const { rerender } = render(<Menu />);
    fireEvent.mouseEnter(row("More"));
    fireEvent.mouseEnter(row("Plain"));
    expect(submenu()).toHaveAttribute("data-state", "closing");
    rerender(<Menu show={false} />);
    expect(document.querySelector(".context-menu")).toHaveAttribute(
      "data-state",
      "closing",
    );
  });

  it("leave in the quickest step there is", () => {
    const css = readFileSync(
      resolve("src/engine/controls/ContextMenu.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.context-submenu\[data-state="closing"\]\s*\{[^}]*var\(--dur-instant\)/,
    );
  });

  it("opened by the pointer fold first on Escape or ←, then Escape closes the menu", () => {
    const onClose = vi.fn();
    render(<Menu keyboard onClose={onClose} />);
    expect(row("Plain")).toHaveFocus();
    for (const key of ["Escape", "ArrowLeft"]) {
      fireEvent.mouseEnter(row("More"));
      expect(submenu()).not.toBeNull();
      fireEvent.keyDown(row("Plain"), { key });
      expect(submenu()).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    }
    fireEvent.keyDown(row("Plain"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("follow their row as the menu scrolls, and fold once it scrolls away", () => {
    render(<Menu />);
    const menu = document.querySelector(".context-menu")!;
    at(menu, 100, 100, 200, 300);
    at(row("More"), 150, 100);
    fireEvent.mouseEnter(row("More"));
    expect(submenu()).toHaveStyle({ top: "146px", left: "304px" });
    at(row("More"), 120, 100);
    fireEvent.scroll(menu);
    expect(submenu()).toHaveStyle({ top: "116px" });
    at(row("More"), 60, 100);
    fireEvent.scroll(menu);
    expect(submenu()).toBeNull();
  });

  it("come back inside a window made smaller", () => {
    const width = window.innerWidth;
    try {
      render(<Menu />);
      at(document.querySelector(".context-menu")!, 100, 300, 200, 300);
      at(row("More"), 150, 300);
      fireEvent.mouseEnter(row("More"));
      at(submenu()!, 0, 0, 150, 100);
      act(() => window.dispatchEvent(new Event("resize")));
      expect(submenu()).toHaveStyle({ left: "504px" });
      window.innerWidth = 600;
      act(() => window.dispatchEvent(new Event("resize")));
      // No room on the right now: on the left.
      expect(submenu()).toHaveStyle({ left: "146px" });
    } finally {
      window.innerWidth = width;
    }
  });
});

it("a menu comes back inside a window made smaller", () => {
  const width = window.innerWidth;
  try {
    render(<Menu />);
    const menu = document.querySelector<HTMLElement>(".context-menu")!;
    Object.defineProperty(menu, "offsetWidth", { value: 200 });
    Object.defineProperty(menu, "offsetHeight", { value: 100 });
    window.innerWidth = 150;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(menu).toHaveStyle({ left: "8px" });
  } finally {
    window.innerWidth = width;
  }
});
