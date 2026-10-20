// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOOLTIP_OPEN_MS, Tooltip } from "./Tooltip";

// jsdom has no ResizeObserver, which useViewportClamp keeps the tooltip in
// the window with; nothing here resizes, so a stub that never fires will do.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeEach(() => {
  vi.useFakeTimers();
  // Past the warm-up window a previous test's tooltip left behind.
  vi.advanceTimersByTime(1000);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(
  text = "Deep thinking: when it's on, Textus AI thinks longer",
  props: { onMouseDown?: (e: React.MouseEvent) => void } = {},
) {
  render(
    <div>
      <Tooltip text={text}>
        <button type="button" aria-label="Deep thinking" {...props}>
          *
        </button>
      </Tooltip>
      <textarea aria-label="Message" />
    </div>,
  );
  return screen.getByRole("button", { name: "Deep thinking" });
}

const rest = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("Tooltip", () => {
  it("opens only once the mouse has rested on the button", () => {
    const button = setup();
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    rest(TOOLTIP_OPEN_MS - 50);
    expect(screen.queryByRole("tooltip")).toBeNull();
    rest(50);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Deep thinking: when it's on",
    );
  });

  it("shows nothing when the mouse only passes over", () => {
    const button = setup();
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    rest(100);
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    rest(TOOLTIP_OPEN_MS);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes when the mouse leaves or presses", () => {
    const button = setup();
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    rest(TOOLTIP_OPEN_MS);
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    rest(200);
    expect(screen.queryByRole("tooltip")).toBeNull();

    rest(1000);
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    rest(TOOLTIP_OPEN_MS);
    fireEvent.pointerDown(button, { pointerType: "mouse" });
    rest(200);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("never opens for a finger", () => {
    const button = setup();
    fireEvent.pointerEnter(button, { pointerType: "touch" });
    rest(TOOLTIP_OPEN_MS * 3);
    fireEvent.pointerDown(button, { pointerType: "touch" });
    fireEvent.click(button);
    rest(TOOLTIP_OPEN_MS * 3);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens at once on keyboard focus and closes on blur", () => {
    const button = setup();
    // Tabbed to: a key went first, so the focus is :focus-visible.
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => button.focus());
    expect(button.matches(":focus-visible")).toBe(true);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    act(() => button.blur());
    rest(200);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes on Escape, taking the key only when the button has focus", () => {
    const button = setup();
    const field = screen.getByRole("textbox", { name: "Message" });
    act(() => field.focus());
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    rest(TOOLTIP_OPEN_MS);
    // A hover tooltip over the composer: the field's Escape still counts.
    const fromField = fireEvent.keyDown(field, { key: "Escape" });
    expect(fromField).toBe(true);
    rest(200);
    expect(screen.queryByRole("tooltip")).toBeNull();

    act(() => button.focus());
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    const fromButton = fireEvent.keyDown(button, { key: "Escape" });
    expect(fromButton).toBe(false);
    rest(200);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("never takes the focus, so a button that holds it in the field keeps it", () => {
    const button = setup(undefined, {
      onMouseDown: (e) => e.preventDefault(),
    });
    const field = screen.getByRole("textbox", { name: "Message" });
    act(() => field.focus());
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    rest(TOOLTIP_OPEN_MS);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(document.activeElement).toBe(field);
    const mouseDown = fireEvent.mouseDown(button);
    expect(mouseDown).toBe(false);
    expect(document.activeElement).toBe(field);
  });

  it("describes the button with its text, without repeating the name", () => {
    const button = setup();
    expect(button).toHaveAccessibleName("Deep thinking");
    expect(button).toHaveAccessibleDescription(
      "Deep thinking: when it's on, Textus AI thinks longer",
    );
    cleanup();
    const plain = setup("Deep thinking");
    expect(plain).toHaveAccessibleName("Deep thinking");
    expect(plain).not.toHaveAttribute("aria-describedby");
  });

  it("opens the next button's tooltip at once while reading a toolbar", () => {
    render(
      <div>
        <Tooltip text="One">
          <button type="button">1</button>
        </Tooltip>
        <Tooltip text="Two">
          <button type="button">2</button>
        </Tooltip>
      </div>,
    );
    const [one, two] = screen.getAllByRole("button");
    fireEvent.pointerEnter(one, { pointerType: "mouse" });
    rest(TOOLTIP_OPEN_MS);
    fireEvent.pointerLeave(one, { pointerType: "mouse" });
    fireEvent.pointerEnter(two, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Two");
  });
});
