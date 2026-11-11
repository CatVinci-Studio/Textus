// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  clearTabZooms,
  keepWindowZoomIn,
  onZoom,
  setTabZoom,
  setWindowZoom,
  zoomOf,
} from "./tab-zoom";

it("gives a tab the window's zoom until it has its own, and keeps it as the default moves", () => {
  let told = 0;
  const stop = onZoom(() => told++);
  setWindowZoom(1.2);
  expect(zoomOf("a")).toBe(1.2);
  setTabZoom("b", 1.5);
  expect(zoomOf("b")).toBe(1.5);
  // A new default: the open tabs keep what they had.
  keepWindowZoomIn(["a", "b"]);
  setWindowZoom(0.9);
  expect([zoomOf("a"), zoomOf("b"), zoomOf("new")]).toEqual([1.2, 1.5, 0.9]);
  // Together: every tab back to the window's.
  clearTabZooms();
  expect(zoomOf("a")).toBe(0.9);
  expect(told).toBeGreaterThan(3);
  stop();
  setWindowZoom(1);
});
