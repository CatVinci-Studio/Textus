// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InfoTip } from "./InfoTip";

// jsdom has no ResizeObserver; nothing here resizes, so a stub will do.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  render(
    <div>
      <InfoTip label="More about Diagram engine">Pele is faster.</InfoTip>
      <button type="button">elsewhere</button>
    </div>,
  );
  return screen.getByRole("button", { name: "More about Diagram engine" });
}

/** The listeners useCloseOnOutsideClick adds after a tick. */
const tick = () => act(() => vi.advanceTimersByTime(1));

describe("InfoTip", () => {
  it("describes its button with the explanation while closed", () => {
    const button = setup();
    expect(button).toHaveAccessibleDescription("Pele is faster.");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens on a resting mouse and closes when it leaves", () => {
    vi.useFakeTimers();
    const button = setup();
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Pele is faster.");
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("stays open while the pointer crosses onto the card", () => {
    vi.useFakeTimers();
    const button = setup();
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(300));
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    fireEvent.pointerEnter(screen.getByRole("tooltip"), {
      pointerType: "mouse",
    });
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("opens on a tap, which a touch screen's hover never does, and a second tap closes it", () => {
    vi.useFakeTimers();
    const button = setup();
    fireEvent.pointerEnter(button, { pointerType: "touch" });
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    // A click keeps it open after the pointer leaves.
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes on Escape and on a press outside", () => {
    vi.useFakeTimers();
    const button = setup();
    fireEvent.click(button);
    tick();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.click(button);
    tick();
    // A press on the card itself is inside.
    fireEvent.mouseDown(screen.getByRole("tooltip"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps a click from reaching the <label> it sits in", () => {
    const toggled = vi.fn();
    render(
      <label>
        <span>Web search</span>
        <InfoTip label="More about Web search">Needs support.</InfoTip>
        <input type="checkbox" onChange={toggled} />
      </label>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "More about Web search" }),
    );
    expect(toggled).not.toHaveBeenCalled();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });
});
