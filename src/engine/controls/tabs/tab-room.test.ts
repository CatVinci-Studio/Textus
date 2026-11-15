// @vitest-environment jsdom
import { expect, it } from "vitest";
import { measuresKey } from "./tab-room";

it("a tab row's measures are kept apart for each interface scale", () => {
  const bar = document.createElement("div");
  bar.className = "tab-bar";
  document.body.append(bar);
  const wide = measuresKey(bar);
  // A narrow window's step: the scale changes on no element's attribute.
  bar.style.setProperty("--chrome-scale", "calc(10 / 11)");
  expect(measuresKey(bar)).not.toBe(wide);
  bar.remove();
});
