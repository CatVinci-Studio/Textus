import { describe, expect, it } from "vitest";
import { settingShown } from "./plugin-settings";

describe("settingShown", () => {
  const values: Record<string, unknown> = {
    legend: true,
    grid: false,
    style: "dark",
    words: [],
  };
  const value = (key: string) => values[key];

  it("shows a setting with no condition", () => {
    expect(settingShown(undefined, value)).toBe(true);
  });

  it("reads a key as on or off, a list as on when it has anything", () => {
    expect(settingShown("legend", value)).toBe(true);
    expect(settingShown("grid", value)).toBe(false);
    expect(settingShown("!grid", value)).toBe(true);
    expect(settingShown("words", value)).toBe(false);
  });

  it("compares a key with a value", () => {
    expect(settingShown("style == dark", value)).toBe(true);
    expect(settingShown("style != dark", value)).toBe(false);
    expect(settingShown("style == light", value)).toBe(false);
  });
});
