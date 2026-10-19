import { expect, it } from "vitest";
import { imageSrcFor } from "./ImageViewer";

it("writes a picture relative to the document when it is under its folder", () => {
  expect(imageSrcFor("/docs/assets/a b (1).png", "/docs/story.md")).toBe(
    "assets/a%20b%20%281%29.png",
  );
  expect(imageSrcFor("/elsewhere/c.png", "/docs/story.md")).toBe(
    "/elsewhere/c.png",
  );
  expect(imageSrcFor("/elsewhere/c.png", null)).toBe("/elsewhere/c.png");
});
