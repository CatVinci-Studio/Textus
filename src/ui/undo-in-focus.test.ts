// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDIT_ACTION_EVENT } from "../utils/events";
import { undoInFocus } from "./undo-in-focus";

describe("undoInFocus", () => {
  beforeEach(() => {
    // jsdom's window never has the system's focus.
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function editActions(): string[] {
    const seen: string[] = [];
    window.addEventListener(EDIT_ACTION_EVENT, (e) =>
      seen.push((e as CustomEvent<string>).detail),
    );
    return seen;
  }

  it("undoes in the document when no field has the keyboard", () => {
    const seen = editActions();
    undoInFocus("undo");
    undoInFocus("redo");
    expect(seen).toEqual(["undo", "redo"]);
  });

  it("leaves a web page tab or the chat window to its own history", async () => {
    const seen = editActions();
    vi.mocked(document.hasFocus).mockReturnValue(false);
    document.execCommand = vi.fn(() => true);
    undoInFocus("redo");
    await vi.waitFor(() =>
      expect(document.execCommand).toHaveBeenCalledWith("redo"),
    );
    expect(seen).toEqual([]);
  });

  it("leaves a focused field to its own history", async () => {
    const seen = editActions();
    document.execCommand = vi.fn(() => true);
    const field = document.createElement("textarea");
    document.body.append(field);
    field.focus();
    undoInFocus("undo");
    await vi.waitFor(() =>
      expect(document.execCommand).toHaveBeenCalledWith("undo"),
    );
    expect(seen).toEqual([]);
  });
});
