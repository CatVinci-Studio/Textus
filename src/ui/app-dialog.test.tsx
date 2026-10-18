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
import { AppDialogHost, showConfirm, showMessage } from "./app-dialog";

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
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await b;
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
