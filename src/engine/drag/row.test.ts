// @vitest-environment jsdom
import { expect, it } from "vitest";
import { clearSlides, shiftBy, shiftsOf, slideAside } from "./row";

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: String(i),
    node: document.createElement("div"),
  }));

it("shifts the others the dragged one passed, one room the other way", () => {
  expect(shiftsOf(4, 0, 2, 40)).toEqual([-40, -40, 0, 0]);
  expect(shiftsOf(4, 3, 1, 40)).toEqual([0, 40, 40, 0]);
  expect(shiftsOf(3, 1, 1, 40)).toEqual([0, 0, 0]);
});

it("rests the others on a transform along the axis, none at home", () => {
  expect(shiftBy(-40, "y")).toBe("translateY(-40px)");
  expect(shiftBy(12, "x")).toBe("translateX(12px)");
  expect(shiftBy(0, "y")).toBe("");
});

it("restyles only the items whose shift changed, and clears them all", () => {
  const others = items(3);
  const shown = [0, 0, 0];
  const drawn = () => others.map((o) => o.node.style.transform);
  slideAside(others, shown, 0, 2, 40, "y");
  expect(shown).toEqual([-40, -40, 0]);
  expect(drawn()).toEqual(["translateY(-40px)", "translateY(-40px)", ""]);
  // One that keeps its shift isn't written again.
  others[0]!.node.style.transform = "translateY(-41px)";
  slideAside(others, shown, 0, 1, 40, "y");
  expect(drawn()).toEqual(["translateY(-41px)", "", ""]);
  clearSlides(others);
  expect(drawn()).toEqual(["", "", ""]);
});
