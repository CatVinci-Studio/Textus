import { expect, it } from "vitest";
import { SilenceStop } from "./silence";
it("stops after 1.5 seconds following voice, resetting on further voice", () => {
  const stop = new SilenceStop(0);
  expect(stop.sample(100, 0.1)).toBeNull();
  expect(stop.sample(1400, 0)).toBeNull();
  expect(stop.sample(1500, 0.1)).toBeNull();
  expect(stop.sample(2999, 0)).toBeNull();
  expect(stop.sample(3000, 0)).toBe("speech");
});
it("times out an empty microphone after five seconds", () => {
  const stop = new SilenceStop(0);
  expect(stop.sample(4999, 0)).toBeNull();
  expect(stop.sample(5000, 0)).toBe("empty");
});
