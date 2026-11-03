// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { letterSpacing } from "./apply-appearance";
import { loadSettings } from "../prefs/SettingsContext";
import { installTestLocalStorage } from "../dev/test-local-storage";

describe("text font, size and spacing", () => {
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

  it("keeps a stored text size to whole px within its range", () => {
    const load = (size: unknown) => {
      localStorage.setItem(
        "catvinci-settings",
        JSON.stringify({ docTextSize: size }),
      );
      return loadSettings().docTextSize;
    };
    expect(load(31)).toBe(31);
    expect(load(16.6)).toBe(17);
    expect(load(200)).toBe(48);
    expect(load(4)).toBe(10);
    expect(load("auto")).toBe("auto");
    expect(load("large")).toBe("auto");
  });

  it("reads line spacing as a number, the named spacings saved before included", () => {
    const load = (spacing: unknown) => {
      localStorage.setItem(
        "catvinci-settings",
        JSON.stringify({ docLineSpacing: spacing }),
      );
      return loadSettings().docLineSpacing;
    };
    expect(load(1.5)).toBe(1.5);
    expect(load(1.234)).toBe(1.23);
    expect(load(9)).toBe(3);
    expect(load("compact")).toBe(1.55);
    expect(load("relaxed")).toBe(2.05);
    expect(load("auto")).toBe("auto");
    expect(load("constructor")).toBe("auto");
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
