import { describe, expect, it } from "vitest";
import { fontLabel, matchFonts, recentGroup } from "./font-families";

const songti = { name: "SimSun", local: { zh: "宋体" } };
const ming = { name: "PMingLiU", local: { "zh-Hant": "新細明體" } };
const georgia = { name: "Georgia", local: {} };
const fonts = [georgia, ming, songti];

describe("the installed fonts as the picker shows them", () => {
  it("names a font in the UI's language, the other Chinese next", () => {
    expect(fontLabel(songti, "zh")).toBe("宋体");
    expect(fontLabel(songti, "zh-Hant")).toBe("宋体");
    expect(fontLabel(ming, "zh")).toBe("新細明體");
    expect(fontLabel(songti, "en")).toBe("SimSun");
    expect(fontLabel(georgia, "zh")).toBe("Georgia");
  });

  it("finds a font by any of its names, or its Chinese one in pinyin", () => {
    expect(matchFonts(fonts, "simsun", "en")).toEqual([songti]);
    expect(matchFonts(fonts, "宋", "en")).toEqual([songti]);
    expect(matchFonts(fonts, "songti", "zh")).toEqual([songti]);
    expect(matchFonts(fonts, "  ", "zh")).toEqual(fonts);
    expect(matchFonts(fonts, "comic", "zh")).toEqual([]);
  });

  it("lists the fonts chosen lately that are here, and a chosen one that is not", () => {
    expect(recentGroup(fonts, ["SimSun", "Gone", "Georgia"], "")).toEqual([
      songti,
      georgia,
    ]);
    expect(recentGroup(fonts, ["Georgia"], "Lora")).toEqual([
      { name: "Lora", local: {} },
      georgia,
    ]);
    expect(recentGroup(fonts, [], "SimSun")).toEqual([]);
  });
});
