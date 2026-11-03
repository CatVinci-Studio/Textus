// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { onPluginEvent } from "../app-bridge";
import {
  closeFloating,
  moveFloating,
  openFloatingViews,
  rememberedOpen,
  showFloating,
  touchFloating,
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

  it("open in the window, on the desktop only where they must be", () => {
    expect(showFloating(pet, true).place).toBe("window");
    closeFloating(pet.view);
    localStorage.clear();
    expect(showFloating({ ...pet, allowed: "desktop" }, true).place).toBe(
      "desktop",
    );
    closeFloating(pet.view);
    localStorage.clear();
    expect(showFloating({ ...pet, allowed: "desktop" }, false).place).toBe(
      "window",
    );
  });

  it("tell their plugin which half they sit in", () => {
    const heard = vi.fn();
    const stop = onPluginEvent("floating", heard);
    showFloating(pet, false);
    expect(heard).toHaveBeenLastCalledWith(
      expect.objectContaining({ side: "right" }),
    );
    moveFloating(pet.view, { x: 0.1, y: 0.5 });
    expect(heard).toHaveBeenLastCalledWith(
      expect.objectContaining({ side: "left" }),
    );
    stop();
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
      side: "left",
    });
    expect(rememberedOpen()).toEqual([pet.view]);
    closeFloating(pet.view);
    expect(rememberedOpen()).toEqual([]);
    const again = showFloating(pet, false);
    expect(again).toMatchObject({ x: 0.25, y: 0.5, folded: false });
    stop();
  });

  it("hear a click as a poke, three quick ones as petting", () => {
    const heard = vi.fn();
    const stop = onPluginEvent("floatingTouch", heard);
    showFloating(pet, false);
    touchFloating(pet.view, "poke");
    expect(heard).toHaveBeenLastCalledWith({
      plugin: pet.plugin,
      view: pet.view,
      kind: "poke",
    });
    touchFloating(pet.view, "poke");
    touchFloating(pet.view, "poke");
    expect(heard).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "pet" }),
    );
    touchFloating(pet.view, "poke");
    expect(heard).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "poke" }),
    );
    stop();
  });
});
