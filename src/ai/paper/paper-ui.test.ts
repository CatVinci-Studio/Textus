import { describe, expect, it } from "vitest";
import { previewText } from "./paper-ui";

describe("a section's preview", () => {
  it("shows the text plain, citations as numbers", () => {
    expect(
      previewText(
        "### Heat\n\nRoofs cool **streets** [3](https://a.example/x).\n\n\n\nMore.",
      ),
    ).toBe("Heat\n\nRoofs cool streets [3].\n\nMore.");
  });
});
