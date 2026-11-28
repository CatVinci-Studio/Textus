// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { headingFor, useMenuAim } from "./menu-aim";

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  right: left + width,
  bottom: top + height,
});
const parent = box(100, 100, 200, 300);
const right = box(296, 140, 200, 240);
const left = box(-96, 140, 200, 240);

describe("headingFor", () => {
  it("is on its way along the triangle to a submenu on the right", () => {
    expect(
      headingFor({ x: 230, y: 200 }, { x: 260, y: 230 }, parent, right),
    ).toBe(true);
  });

  it("isn't, moving away from the submenu's edge", () => {
    expect(
      headingFor({ x: 260, y: 230 }, { x: 240, y: 300 }, parent, right),
    ).toBe(false);
  });

  it("isn't, outside the triangle below the submenu's reach", () => {
    expect(
      headingFor({ x: 230, y: 200 }, { x: 240, y: 395 }, parent, right),
    ).toBe(false);
  });

  it("isn't, far from the side the submenu is on", () => {
    expect(
      headingFor({ x: 110, y: 200 }, { x: 150, y: 210 }, parent, right),
    ).toBe(false);
  });

  it("follows a submenu flipped to the left", () => {
    expect(
      headingFor({ x: 170, y: 200 }, { x: 140, y: 230 }, parent, left),
    ).toBe(true);
  });

  it("isn't, going straight down or not moving, however near the submenu", () => {
    expect(
      headingFor({ x: 280, y: 200 }, { x: 280, y: 200 }, parent, right),
    ).toBe(false);
    expect(
      headingFor({ x: 290, y: 200 }, { x: 290, y: 215 }, parent, right),
    ).toBe(false);
  });
});

describe("useMenuAim", () => {
  function setup() {
    const menu = document.createElement("div");
    const sub = document.createElement("div");
    menu.getBoundingClientRect = () => parent as DOMRect;
    sub.getBoundingClientRect = () => right as DOMRect;
    const apply = vi.fn();
    const { result } = renderHook(() =>
      useMenuAim<number>(
        apply,
        () => menu,
        () => sub,
      ),
    );
    const move = (x: number, y: number) =>
      result.current.move({ clientX: x, clientY: y, target: menu });
    return { aim: result.current, move, menu, apply };
  }

  it("opens the next row at once on a step straight down after a sideways move", () => {
    const { aim, move, apply } = setup();
    move(230, 200);
    move(260, 210);
    aim.hover(2, { clientX: 260, clientY: 228 });
    expect(apply).toHaveBeenCalledWith(2);
  });

  it("stops waiting the moment the pointer turns off its way to the submenu", () => {
    const { aim, move, menu, apply } = setup();
    move(230, 200);
    move(260, 230);
    aim.hover(2);
    expect(apply).not.toHaveBeenCalled();
    expect(menu.dataset.aiming).toBe("");
    move(260, 250);
    expect(apply).toHaveBeenCalledWith(2);
    expect(menu.dataset.aiming).toBeUndefined();
  });

  it("forgets the aim once the pointer leaves the menu", () => {
    const { aim, move, menu } = setup();
    move(230, 200);
    move(260, 230);
    expect(menu.dataset.aiming).toBe("");
    aim.leave();
    expect(menu.dataset.aiming).toBeUndefined();
  });
});
