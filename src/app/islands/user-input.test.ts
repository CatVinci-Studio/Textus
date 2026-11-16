// @vitest-environment jsdom
import { expect, it } from "vitest";
import { userHasActed } from "./user-input";

it("knows no user input at launch, and a key or a pointer after", () => {
  expect(userHasActed()).toBe(false);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
  expect(userHasActed()).toBe(true);
});
