// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { letterSpacing } from "./apply-appearance";
import { loadSettings } from "../prefs/SettingsContext";
import { installTestLocalStorage } from "../dev/test-local-storage";

describe("text font and character spacing", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("sets character spacing the way Word does", () => {
    expect(letterSpacing("auto", 1)).toBeNull();
    expect(letterSpacing("normal", 3)).toBe("normal");
    expect(letterSpacing("expanded", 1.5)).toBe("1.5pt");
    expect(letterSpacing("condensed", 0.5)).toBe("-0.5pt");
  });

  it("keeps a stored spacing within Word's range and step", () => {
    const load = (by: unknown) => {
      localStorage.setItem(
        "catvinci-settings",
        JSON.stringify({
          docLetterSpacing: "expanded",
          docLetterSpacingBy: by,
        }),
      );
      return loadSettings();
    };
    expect(load(2.34).docLetterSpacingBy).toBe(2.3);
    expect(load(99).docLetterSpacingBy).toBe(10);
    expect(load(0).docLetterSpacingBy).toBe(0.1);
    expect(load("x").docLetterSpacingBy).toBe(1);
    expect(load(1).docLetterSpacing).toBe("expanded");
  });

  it("follows the theme until a font is chosen", () => {
    expect(loadSettings().docFont).toBe("");
    localStorage.setItem(
      "catvinci-settings",
      JSON.stringify({ docFont: " Songti SC " }),
    );
    expect(loadSettings().docFont).toBe("Songti SC");
  });
});
