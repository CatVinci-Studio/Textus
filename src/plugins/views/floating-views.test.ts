// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { onPluginEvent } from "../app-bridge";
import {
  closeFloating,
  moveFloating,
  openFloatingViews,
  rememberedOpen,
  showFloating,
} from "./floating-views";

const pet = {
  plugin: "catvinci.desk-pet",
  view: "catvinci.desk-pet.pet",
  title: "Desk pet",
  width: 160,
  height: 160,
  allowed: "either" as const,
};

describe("floating views", () => {
  beforeEach(() => {
    localStorage.clear();
    for (const view of openFloatingViews()) closeFloating(view.view);
  });

  it("open on the desktop where they may, else in the window", () => {
    expect(showFloating(pet, true).place).toBe("desktop");
    closeFloating(pet.view);
    localStorage.clear();
    expect(showFloating(pet, false).place).toBe("window");
    closeFloating(pet.view);
    localStorage.clear();
    expect(showFloating({ ...pet, allowed: "window" }, true).place).toBe(
      "window",
    );
  });

  it("reopen where they were left, and tell their plugin each change", () => {
    const heard = vi.fn();
    const stop = onPluginEvent("floating", heard);
    showFloating(pet, false);
    moveFloating(pet.view, { x: 0.25, y: 0.5 });
    moveFloating(pet.view, { folded: true });
    expect(heard).toHaveBeenLastCalledWith({
      plugin: pet.plugin,
      view: pet.view,
      open: true,
      visible: false,
      place: "window",
    });
    expect(rememberedOpen()).toEqual([pet.view]);
    closeFloating(pet.view);
    expect(rememberedOpen()).toEqual([]);
    const again = showFloating(pet, false);
    expect(again).toMatchObject({ x: 0.25, y: 0.5, folded: false });
    stop();
  });
});
