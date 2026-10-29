// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDIT_ACTION_EVENT } from "../utils/events";
import { editInFocus } from "./edit-in-focus";

describe("editInFocus", () => {
  let seen: string[];
  const record = (e: Event) => seen.push((e as CustomEvent<string>).detail);

  beforeEach(() => {
    seen = [];
    window.addEventListener(EDIT_ACTION_EVENT, record);
    // jsdom's window never has the system's focus.
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    document.execCommand = vi.fn(() => true);
  });

  afterEach(() => {
    window.removeEventListener(EDIT_ACTION_EVENT, record);
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("acts in the document when no field has the keyboard", () => {
    editInFocus("undo");
    editInFocus("redo");
    editInFocus("select-all");
    expect(seen).toEqual(["undo", "redo", "select-all"]);
  });

  it("leaves a focused field to its own history and selection", async () => {
    const field = document.createElement("textarea");
    field.value = "words";
    document.body.append(field);
    field.focus();
    editInFocus("select-all");
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 5]);
    editInFocus("undo");
    await vi.waitFor(() =>
      expect(document.execCommand).toHaveBeenCalledWith("undo"),
    );
    expect(seen).toEqual([]);
  });

  it("leaves a web page tab or the chat window to itself", async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    editInFocus("redo");
    await vi.waitFor(() =>
      expect(document.execCommand).toHaveBeenCalledWith("redo"),
    );
    // With no native Select All, never the page's: it takes the whole window.
    editInFocus("select-all");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.execCommand).not.toHaveBeenCalledWith("selectAll");
    expect(seen).toEqual([]);
  });

  it("does nothing behind an open dialog", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    const button = document.createElement("button");
    dialog.append(button);
    document.body.append(dialog);
    button.focus();
    editInFocus("undo");
    expect(seen).toEqual([]);
    expect(document.execCommand).not.toHaveBeenCalled();
  });
});
