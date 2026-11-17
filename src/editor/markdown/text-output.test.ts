import { expect, it } from "vitest";
import { displayWidth } from "./text-output";

it("counts a table cell as a monospaced editor shows it", () => {
  expect(displayWidth("abc")).toBe(3);
  expect(displayWidth("中文")).toBe(4);
  expect(displayWidth("😀")).toBe(2);
  // One character to the eye, however many code points.
  expect(displayWidth("👨‍👩‍👧‍👦")).toBe(2);
  expect(displayWidth("❤️")).toBe(2);
  expect(displayWidth("é")).toBe(1);
});
