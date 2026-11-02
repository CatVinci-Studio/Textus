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

  it("numbers citations as the paper does", () => {
    expect(
      previewText("A [93](https://a.example/x).", new Map([[93, 1]])),
    ).toBe("A [1].");
  });
});
