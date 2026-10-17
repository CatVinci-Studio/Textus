import { expect, it } from "vitest";
import { DictationRange } from "./dictation-range";
it("replaces partial speech within the captured range and preserves surrounding text", () => {
  const range = new DictationRange("before OLD after", 7, 10);
  expect(range.update("before OLD after", "你")).toBe("before 你 after");
  expect(range.update("before 你 after", "你好")).toBe("before 你好 after");
  expect(range.update("manually edited", "late result")).toBeNull();
});
