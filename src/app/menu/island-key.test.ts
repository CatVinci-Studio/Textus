import { describe, expect, it } from "vitest";
import { islandKeyOf } from "./island-key";
import { defaultShortcuts } from "../../prefs/shortcut-defaults";

describe("islandKeyOf", () => {
  const shortcuts = defaultShortcuts();

  it("reads a heading's menu item as the number key that reaches it", () => {
    expect(islandKeyOf("h1", shortcuts)).toBe(1);
    expect(islandKeyOf("h6", shortcuts)).toBe(6);
  });

  it("follows a heading moved to another number", () => {
    expect(islandKeyOf("h2", { ...shortcuts, setHeading2: "mod+5" })).toBe(5);
  });

  it("is none for a heading on other keys, or another block", () => {
    expect(
      islandKeyOf("h2", { ...shortcuts, setHeading2: "alt+2" }),
    ).toBeNull();
    expect(islandKeyOf("h3", { ...shortcuts, setHeading3: "" })).toBeNull();
    expect(islandKeyOf("paragraph", shortcuts)).toBeNull();
    expect(islandKeyOf("bullet-list", shortcuts)).toBeNull();
  });
});
