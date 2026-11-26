import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "./settings-types";
import { normaliseSettings } from "./settings-normalise";
import {
  CLASSIC_LOOK,
  classicLookChange,
  isClassicLook,
  storedLook,
} from "./classic-look";

const apply = (s: Settings, on: boolean): Settings => ({
  ...s,
  ...classicLookChange(on, s),
});

describe("the classic look", () => {
  it("turned on and off again gives back the look it left", () => {
    const mine: Settings = {
      ...DEFAULT_SETTINGS,
      layout: "islands",
      activityRail: false,
      titleRowShown: false,
    };
    const on = apply(mine, true);
    expect(isClassicLook(on)).toBe(true);
    expect(on).toMatchObject(CLASSIC_LOOK);
    const off = apply(on, false);
    expect(isClassicLook(off)).toBe(false);
    expect(off).toMatchObject({
      layout: "islands",
      activityRail: false,
      titleRowShown: false,
      lookBeforeClassic: null,
    });
  });

  it("off with nothing kept is the defaults", () => {
    const set: Settings = { ...DEFAULT_SETTINGS, ...CLASSIC_LOOK };
    expect(isClassicLook(set)).toBe(true);
    expect(apply(set, false)).toMatchObject({
      layout: DEFAULT_SETTINGS.layout,
      activityRail: DEFAULT_SETTINGS.activityRail,
      titleRowShown: DEFAULT_SETTINGS.titleRowShown,
    });
  });

  it("keeps only a whole stored look", () => {
    expect(storedLook({ ...CLASSIC_LOOK, extra: 1 })).toEqual(CLASSIC_LOOK);
    expect(
      storedLook({ layout: "flat", activityRail: true, titleRowShown: true }),
    ).toBeNull();
    expect(storedLook("classic")).toBeNull();
  });
});

describe("the classic look and the frame's colour", () => {
  it("puts the frame in the page's colour and gives back the one it left", () => {
    const on = apply({ ...DEFAULT_SETTINGS }, true);
    expect(on.plainFrame).toBe(true);
    expect(apply(on, false).plainFrame).toBe(false);
  });

  it("reads a look kept before the frame had a setting", () => {
    expect(
      storedLook({
        layout: "islands",
        activityRail: true,
        titleRowShown: false,
      }),
    ).toEqual({
      layout: "islands",
      activityRail: true,
      titleRowShown: false,
      plainFrame: false,
    });
  });
});

describe("settings saved before the frame had a setting", () => {
  const classic = {
    layout: "classic",
    activityRail: false,
    titleRowShown: true,
  };

  it("keep the classic look's switch on, frame included", () => {
    const settings = normaliseSettings({ ...classic });
    expect(settings.plainFrame).toBe(true);
    expect(isClassicLook(settings)).toBe(true);
  });

  it("leave the frame alone elsewhere, and a choice made stays", () => {
    expect(normaliseSettings({ layout: "islands" }).plainFrame).toBe(false);
    expect(
      normaliseSettings({ ...classic, plainFrame: false }).plainFrame,
    ).toBe(false);
  });

  it("read a kept look's frame as a boolean only", () => {
    expect(storedLook({ ...classic, plainFrame: "yes" })?.plainFrame).toBe(
      false,
    );
  });
});
