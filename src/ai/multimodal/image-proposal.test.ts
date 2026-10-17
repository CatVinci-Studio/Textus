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
