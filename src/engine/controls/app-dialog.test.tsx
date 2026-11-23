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
import {
  AppDialogHost,
  showConfirm,
  showConfirmCheck,
  showMessage,
} from "./app-dialog";

afterEach(cleanup);

describe("app dialogs", () => {
  it("answers a confirm with the button pressed, and Escape as cancel", async () => {
    render(<AppDialogHost okLabel="OK" />);
    let first!: Promise<boolean>;
    act(() => {
      first = showConfirm("Overwrite the file?", {
        title: "Changed on disk",
        okLabel: "Overwrite",
        cancelLabel: "Cancel",
      });
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("Overwrite the file?");
    fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
    await expect(first).resolves.toBe(true);

    let second!: Promise<boolean>;
    act(() => {
      second = showConfirm("Again?", {
        okLabel: "Yes",
        cancelLabel: "No",
      });
    });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await expect(second).resolves.toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("starts on Cancel when asked, so Enter keeps things as they are", async () => {
    render(<AppDialogHost okLabel="OK" />);
    let answer!: Promise<boolean>;
    act(() => {
      answer = showConfirm("Overwrite the file?", {
        okLabel: "Overwrite",
        cancelLabel: "Cancel",
        focusCancel: true,
      });
    });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(document.activeElement!);
    await expect(answer).resolves.toBe(false);
  });

  it("says whether its box was ticked, and never on cancel", async () => {
    render(<AppDialogHost okLabel="OK" />);
    const ask = () => {
      let answer!: Promise<{ ok: boolean; checked: boolean }>;
      act(() => {
        answer = showConfirmCheck("Copy 2 items?", {
          okLabel: "Copy",
          cancelLabel: "Cancel",
          checkLabel: "Don't ask again",
        });
      });
      return answer;
    };
    let answer = ask();
    expect(
      screen.getByRole("checkbox", { name: "Don't ask again" }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await expect(answer).resolves.toEqual({ ok: true, checked: false });

    answer = ask();
    fireEvent.click(screen.getByRole("checkbox", { name: "Don't ask again" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await expect(answer).resolves.toEqual({ ok: true, checked: true });

    answer = ask();
    fireEvent.click(screen.getByRole("checkbox", { name: "Don't ask again" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(answer).resolves.toEqual({ ok: false, checked: false });
  });

  it("queues a second notice behind the first", async () => {
    render(<AppDialogHost okLabel="OK" />);
    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = showMessage("First", { tone: "error", title: "Export failed" });
      b = showMessage("Second");
    });
    expect(screen.getByRole("alertdialog")).toHaveTextContent("First");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await a;
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Second");
    // The queued one has the focus, as a box of its own would.
    expect(screen.getByRole("button", { name: "OK" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await b;
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
