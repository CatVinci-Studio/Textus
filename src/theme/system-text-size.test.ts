// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { stepFor, systemUiScale } from "./system-text-size";
import { UI_SYSTEM_SIZES } from "../prefs/settings-values";
import { normaliseSettings } from "../prefs/settings-normalise";

describe("the system's text size as an Interface Size step", () => {
  it("reads iOS's Text Size by its body text", () => {
    const at = (pt: number) => stepFor(pt, UI_SYSTEM_SIZES.ios);
    expect([14, 15].map(at)).toEqual([0.85, 0.85]);
    expect([16, 17].map(at)).toEqual([1, 1]);
    expect([19, 21].map(at)).toEqual([1.25, 1.25]);
    expect([23, 28].map(at)).toEqual([1.5, 1.5]);
    expect([33, 53].map(at)).toEqual([1.75, 1.75]);
  });

  it("reads Android's font size by its scale", () => {
    const at = (scale: number) => stepFor(scale, UI_SYSTEM_SIZES.android);
    expect([0.85, 1, 1.15, 1.3, 1.5, 1.8, 2].map(at)).toEqual([
      0.85, 1, 1.25, 1.25, 1.5, 1.5, 1.75,
    ]);
  });

  afterEach(() => {
    delete (window as { TextusAndroid?: unknown }).TextusAndroid;
  });

  it("asks Android's app, and has none to follow on a desktop", () => {
    expect(systemUiScale()).toBeNull();
    (window as { TextusAndroid?: unknown }).TextusAndroid = {
      fontScale: () => 1.3,
    };
    expect(systemUiScale()).toBe(1.25);
  });
});

describe("following the system", () => {
  it("is the default, but not over a size picked before it was offered", () => {
    expect(normaliseSettings(null).uiSizeFollowsSystem).toBe(true);
    expect(normaliseSettings({ uiTextScale: 1 }).uiSizeFollowsSystem).toBe(
      true,
    );
    expect(normaliseSettings({ uiTextScale: 1.25 }).uiSizeFollowsSystem).toBe(
      false,
    );
    expect(
      normaliseSettings({ uiTextScale: 1.25, uiSizeFollowsSystem: true })
        .uiSizeFollowsSystem,
    ).toBe(true);
  });
});
