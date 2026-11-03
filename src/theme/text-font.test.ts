// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { letterSpacing } from "./apply-appearance";
import { loadSettings } from "../prefs/SettingsContext";
import { installTestLocalStorage } from "../dev/test-local-storage";

describe("text font, size and spacing", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("sets character spacing in points, 0 as normal", () => {
    expect(letterSpacing("auto")).toBeNull();
    expect(letterSpacing(0)).toBe("normal");
    expect(letterSpacing(1.5)).toBe("1.5pt");
    expect(letterSpacing(-0.5)).toBe("-0.5pt");
  });

  it("keeps stored character spacing to its points' range", () => {
    const load = (spacing: unknown) => {
      localStorage.setItem(
        "catvinci-settings",
        JSON.stringify({ docLetterSpacing: spacing }),
      );
      return loadSettings().docLetterSpacing;
    };
    expect(load(2.34)).toBe(2.3);
    expect(load(-1.26)).toBe(-1.3);
    expect(load(42)).toBe(10);
    expect(load(-99)).toBe(-10);
    expect(load(0)).toBe(0);
    expect(load("auto")).toBe("auto");
    expect(load("expanded")).toBe("auto");
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
