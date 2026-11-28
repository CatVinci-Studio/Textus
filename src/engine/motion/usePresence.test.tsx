// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Presence,
  endExits,
  usePresenceProps,
  usePresenceState,
} from "./usePresence";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Panel({ label }: { label: string }) {
  const props = usePresenceProps<HTMLDivElement>();
  return (
    <div role="dialog" aria-label={label} {...props}>
      {usePresenceState()}
    </div>
  );
}

function Host({ open, label = "Panel" }: { open: boolean; label?: string }) {
  return <Presence show={open}>{open && <Panel label={label} />}</Presence>;
}

/** Gives the element a running exit, the way a closing stylesheet does
 *  (jsdom computes no CSS animations of its own). */
function withExit(finished: Promise<unknown>) {
  const animation = {
    playState: "running",
    effect: { getComputedTiming: () => ({ endTime: 120 }) },
    finished,
  } as unknown as Animation;
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value(this: HTMLElement) {
      return this.dataset.state === "closing" ? [animation] : [];
    },
  });
  return () => {
    delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
  };
}

describe("Presence", () => {
  it("mounts open and leaves at once when no exit runs", () => {
    const { rerender } = render(<Host open />);
    const panel = screen.getByRole("dialog");
    expect(panel).toHaveAttribute("data-state", "open");
    expect(panel).not.toHaveAttribute("inert");
    rerender(<Host open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the last content, inert, while its exit plays", async () => {
    let end!: () => void;
    const restore = withExit(new Promise<void>((resolve) => (end = resolve)));
    try {
      const { rerender } = render(<Host open label="Rename" />);
      rerender(<Host open={false} label="Gone" />);
      // Still the content it closed with, marked for the stylesheet.
      const panel = screen.getByRole("dialog", { hidden: true });
      expect(panel).toHaveAttribute("aria-label", "Rename");
      expect(panel).toHaveAttribute("data-state", "closing");
      expect(panel).toHaveAttribute("inert");
      expect(panel).toHaveTextContent("closing");
      await act(async () => end());
      expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    } finally {
      restore();
    }
  });

  it("leaves after the fallback time when the exit never reports back", () => {
    vi.useFakeTimers();
    const restore = withExit(new Promise(() => {}));
    try {
      const { rerender } = render(<Host open />);
      rerender(<Host open={false} />);
      expect(screen.getByRole("dialog", { hidden: true })).toBeInTheDocument();
      // The longest exit the tokens have (--dur-sheet), and a little.
      act(() => vi.advanceTimersByTime(400));
      expect(screen.getByRole("dialog", { hidden: true })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(110));
      expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    } finally {
      restore();
    }
  });

  it("reopening during the exit mounts a fresh copy, open", () => {
    const restore = withExit(new Promise(() => {}));
    try {
      const { rerender } = render(<Host open />);
      const first = screen.getByRole("dialog");
      rerender(<Host open={false} />);
      rerender(<Host open />);
      // As it mounted before exits existed: autoFocus and mount effects
      // run again, and the copy going out is gone at once.
      const again = screen.getByRole("dialog");
      expect(again).not.toBe(first);
      expect(first.isConnected).toBe(false);
      expect(again).toHaveAttribute("data-state", "open");
      expect(again).not.toHaveAttribute("inert");
    } finally {
      restore();
    }
  });

  it("ends at once the exits endExits names, and only those", () => {
    const restore = withExit(new Promise(() => {}));
    try {
      const { rerender } = render(
        <>
          <Host open label="Menu" />
          <Host open label="Dialog" />
        </>,
      );
      const menu = screen.getByRole("dialog", { name: "Menu" });
      menu.dataset.list = "";
      rerender(
        <>
          <Host open={false} label="Menu" />
          <Host open={false} label="Dialog" />
        </>,
      );
      act(() => endExits("[data-list]"));
      expect(menu.isConnected).toBe(false);
      expect(
        screen.getByRole("dialog", { name: "Dialog", hidden: true }),
      ).toHaveAttribute("data-state", "closing");
    } finally {
      restore();
    }
  });
});
