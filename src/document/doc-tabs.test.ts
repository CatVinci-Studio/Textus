import { describe, expect, it } from "vitest";
import { makeBlankTab, windowIsUntouched } from "./doc-tabs";

describe("windowIsUntouched", () => {
  it("holds for a fresh window's Untitled tab", () => {
    expect(windowIsUntouched([makeBlankTab()])).toBe(true);
  });

  it("fails once something is typed in the Untitled tab", () => {
    expect(windowIsUntouched([{ ...makeBlankTab(), content: "x" }])).toBe(
      false,
    );
  });

  it("fails for a window with a file open, even an empty saved one", () => {
    expect(
      windowIsUntouched([{ ...makeBlankTab(), path: "/notes/empty.md" }]),
    ).toBe(false);
  });

  it("fails for a window showing a Help document", () => {
    expect(
      windowIsUntouched([{ ...makeBlankTab(), helpDoc: "markdown" }]),
    ).toBe(false);
  });

  it("fails when any tab, not only the active one, holds something", () => {
    expect(
      windowIsUntouched([
        makeBlankTab(),
        { ...makeBlankTab(), content: "draft", savedContent: "" },
      ]),
    ).toBe(false);
  });
});
