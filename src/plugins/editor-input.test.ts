// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { keyName } from "./editor-input";

const press = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("keyName", () => {
  it("names a key with its modifiers, a letter in lower case", () => {
    expect(keyName(press({ key: "j" }))).toBe("j");
    expect(keyName(press({ key: "J", shiftKey: true }))).toBe("J");
    expect(keyName(press({ key: "F", ctrlKey: true, shiftKey: true }))).toBe(
      "ctrl+f",
    );
    expect(keyName(press({ key: "Escape" }))).toBe("Escape");
    expect(keyName(press({ key: "Tab", shiftKey: true }))).toBe("shift+Tab");
    expect(keyName(press({ key: " ", ctrlKey: true }))).toBe("ctrl+ ");
  });

  it("names an Option chord by the key, not the character a Mac types", () => {
    expect(keyName(press({ key: "ƒ", code: "KeyF", altKey: true }))).toBe(
      "alt+f",
    );
    expect(
      keyName(press({ key: "¯", code: "Comma", altKey: true, shiftKey: true })),
    ).toBe("alt+<");
    expect(keyName(press({ key: "Backspace", altKey: true }))).toBe(
      "alt+Backspace",
    );
  });
});
