import { describe, expect, it } from "vitest";
import { barLayout, type BarPlatform } from "./bar-layout";

const at = (
  platform: BarPlatform,
  more: Partial<Parameters<typeof barLayout>[0]> = {},
) =>
  barLayout({
    platform,
    menuBar: false,
    rail: true,
    zen: false,
    fullscreen: false,
    ...more,
  });

describe("the window bar's start", () => {
  it("puts Windows' and Linux's menu in the rail's column, with no sidebar button beside the rail", () => {
    for (const platform of ["windows", "linux"] as const)
      expect(at(platform)).toEqual({
        rows: 1,
        lead: ["menu"],
        menuInRail: true,
        sideToTop: true,
        railToTop: false,
      });
  });

  it("brings the sidebar button back without the rail, and in Zen", () => {
    expect(at("windows", { rail: false }).lead).toEqual([
      "menu",
      "sidebar-toggle",
    ]);
    expect(at("linux", { zen: true })).toEqual({
      rows: 1,
      lead: ["menu", "sidebar-toggle"],
      menuInRail: false,
      sideToTop: false,
      railToTop: false,
    });
    expect(at("macos", { rail: false }).lead).toEqual([
      "lights",
      "sidebar-toggle",
    ]);
  });

  it("keeps the traffic lights' room on a Mac, but not in full screen", () => {
    expect(at("macos").lead).toEqual(["lights"]);
    expect(at("macos", { fullscreen: true }).lead).toEqual([]);
    expect(at("macos", { fullscreen: true, rail: false }).lead).toEqual([
      "sidebar-toggle",
    ]);
  });

  it("lets the sidebar, and on a Mac in full screen the rail, reach the window's top where the bar leaves their columns free", () => {
    expect(at("macos").sideToTop).toBe(false);
    expect(at("macos", { fullscreen: true })).toMatchObject({
      sideToTop: true,
      railToTop: true,
    });
    expect(at("macos", { fullscreen: true, zen: true }).sideToTop).toBe(false);
    expect(at("windows").railToTop).toBe(false);
    expect(at("windows", { rail: false }).sideToTop).toBe(false);
  });

  it("gives the menu bar spelled out a row of its own, on Windows and Linux only", () => {
    expect(at("windows", { menuBar: true })).toEqual({
      rows: 2,
      lead: ["menu-bar"],
      menuInRail: false,
      sideToTop: false,
      railToTop: false,
    });
    expect(at("linux", { menuBar: true, rail: false }).rows).toBe(2);
    // Zen shows no documents' tabs: one row.
    expect(at("windows", { menuBar: true, zen: true }).rows).toBe(1);
    expect(at("macos", { menuBar: true }).rows).toBe(1);
  });
});
