// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { holdKeyboard } from "./hold-keyboard";

describe("holding the keyboard for a field opened after the tap", () => {
  it("focuses a stand-in at once, which goes when the field takes the focus", () => {
    holdKeyboard();
    const stand = document.querySelector<HTMLInputElement>(
      ".tx-keyboard-stand-in",
    );
    expect(document.activeElement).toBe(stand);
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    expect(document.querySelector(".tx-keyboard-stand-in")).toBeNull();
    field.remove();
  });
});
