// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDIT_ACTION_EVENT } from "../utils/events";
import { undoInFocus } from "./undo-in-focus";

describe("undoInFocus", () => {
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

  it("leaves a focused field to its own history", () => {
    const seen = editActions();
    document.execCommand = vi.fn(() => true);
    const field = document.createElement("textarea");
    document.body.append(field);
    field.focus();
    undoInFocus("undo");
    expect(document.execCommand).toHaveBeenCalledWith("undo");
    expect(seen).toEqual([]);
  });
});
