import { describe, expect, it } from "vitest";
import { adjacentTabId, makeBlankTab, windowIsUntouched } from "./doc-tabs";

describe("adjacentTabId", () => {
  const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("steps to the next and the previous tab in bar order", () => {
    expect(adjacentTabId(tabs, "a", 1)).toBe("b");
    expect(adjacentTabId(tabs, "c", -1)).toBe("b");
  });

  it("wraps from the last tab to the first, and back", () => {
    expect(adjacentTabId(tabs, "c", 1)).toBe("a");
    expect(adjacentTabId(tabs, "a", -1)).toBe("c");
  });

  it("has nowhere to go with a single tab", () => {
    expect(adjacentTabId([{ id: "a" }], "a", 1)).toBeNull();
  });
});

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
