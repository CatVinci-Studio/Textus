// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QuickPickHost } from "./quick-pick";
import { showQuickPick } from "./quick-pick-queue";

// jsdom lays nothing out.
HTMLElement.prototype.scrollIntoView = () => {};

afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
});

/** A closing stylesheet's exit on the closing backdrop, as a browser runs
 *  it (jsdom computes no CSS animations). */
function withExit() {
  const exit = {
    playState: "running",
    effect: { getComputedTiming: () => ({ endTime: 120 }) },
    finished: new Promise(() => {}),
  } as unknown as Animation;
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value(this: HTMLElement) {
      return this.dataset.state === "closing" ? [exit] : [];
    },
  });
}

describe("the quick pick", () => {
  it("answered, plays the dialogs' exit rather than vanishing", async () => {
    withExit();
    render(<QuickPickHost emptyLabel="Nothing" okLabel="OK" />);
    let answered: unknown = "pending";
    act(() => {
      void showQuickPick([{ label: "One" }], "Pick").then((value) => {
        answered = value;
      });
    });
    const input = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(answered).toBe("One");
    const dialog = screen.getByRole("dialog", { hidden: true });
    const backdrop = dialog.parentElement!;
    expect(backdrop).toHaveAttribute("data-state", "closing");
    expect(backdrop).toHaveAttribute("inert");
  });
});
