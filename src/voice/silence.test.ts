import { expect, it } from "vitest";
import { SilenceStop } from "./silence";
it("stops 2.5 seconds after voice, resetting on further voice", () => {
  const stop = new SilenceStop(0);
  expect(stop.sample(100, 0.1)).toBeNull();
  // A thinking pause shorter than 2.5 s keeps listening.
  expect(stop.sample(2400, 0)).toBeNull();
  expect(stop.sample(2500, 0.1)).toBeNull();
  expect(stop.sample(4999, 0)).toBeNull();
  expect(stop.sample(5000, 0)).toBe("speech");
});
it("times out an empty microphone after eight seconds", () => {
  const stop = new SilenceStop(0);
  expect(stop.sample(7999, 0)).toBeNull();
  expect(stop.sample(8000, 0)).toBe("empty");
});
