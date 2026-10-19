import { expect, it } from "vitest";
import { imageMarkdown } from "./image-proposal";
it("escapes model-provided alt and caption text and keeps local resource paths", () => {
  const markdown = imageMarkdown("assets/a (1).png", {
    prompt: "test",
    anchor: "## Heading",
    alt: "a] [link](https://bad)",
    caption: "*caption* <img>",
  });
  expect(markdown).toContain("assets/a%20%281%29.png");
  expect(markdown).toContain("a\\] \\[link\\]");
  expect(markdown).toContain("\\<img\\>");
});

it("never captions a picture with the passage it was made from", () => {
  const markdown = imageMarkdown("assets/a.png", {
    prompt: "test",
    anchor: "雨不大，斜着落。\n\n声控灯抖了一下。",
    alt: "雨不大，斜着落。 声控灯抖了一下。",
    caption: null,
    size: "1024x1024",
  });
  expect(markdown).toBe("![雨不大，斜着落。 声控灯抖了一下。](assets/a.png)");
});
