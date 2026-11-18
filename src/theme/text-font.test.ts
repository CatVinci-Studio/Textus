// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { letterSpacing } from "./apply-appearance";
import { loadSettings } from "../prefs/SettingsContext";
import { installTestLocalStorage } from "../dev/test-local-storage";
import { fontChoices } from "../settings/sections/font-choices";
import { vi } from "vitest";

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

  it("offers well-made faces first, then every face the web view draws", () => {
    // The canvas: CJK faces draw everything, any other face Latin only;
    // "Hidden" is known to the web view by its Chinese name alone.
    const cjk = ["PingFang SC", "Songti SC", "微软雅黑", "隐藏"];
    let font = "";
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      set font(value: string) {
        font = value;
      },
      measureText: (text: string) => {
        const named = /"([^"]+)"/.exec(font)?.[1];
        const known =
          !!named && named !== "Hidden" && named !== "Microsoft YaHei";
        const own = known && (/^[ -~]+$/.test(text) || cjk.includes(named!));
        return { width: own ? 1 : 2 };
      },
    } as unknown as CanvasRenderingContext2D);
    const family = (name: string, zh?: string) => ({
      name,
      local: zh ? [{ language: "zh", name: zh }] : [],
    });
    const installed = [
      family("Georgia"),
      family("Hidden", "隐藏"),
      family("Microsoft YaHei", "微软雅黑"),
      family("PingFang SC", "苹方-简"),
      family("Zapfino"),
    ];
    const label = (c: { label: string }) => c.label;
    const zh = fontChoices(installed, "zh");
    expect(zh.recommended.map(label)).toEqual([
      "苹方-简 PingFang SC",
      "微软雅黑 Microsoft YaHei",
      "Georgia",
    ]);
    expect(zh.recommended[1].value).toBe("微软雅黑");
    expect(zh.more.map(label)).toEqual(["隐藏 Hidden", "Zapfino"]);
    const en = fontChoices(installed, "en");
    expect(en.recommended.map(label)).toEqual(["Georgia"]);
    expect(en.more.map(label)).toEqual([
      "Hidden",
      "Microsoft YaHei",
      "PingFang SC",
      "Zapfino",
    ]);
    vi.restoreAllMocks();
  });
});
