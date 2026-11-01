// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { keptTabs, readKeptTabs, writeKeptTabs } from "./reload-tabs";
import type { DocTab } from "./doc-tabs";

const tab = (over: Partial<DocTab>): DocTab => ({
  id: "a",
  path: "/n/a.md",
  content: "same",
  savedContent: "same",
  diskMtime: 1,
  sourceMode: false,
  reloadKey: 0,
  ...over,
});

afterEach(() => sessionStorage.clear());

describe("keptTabs", () => {
  it("keeps a saved document by its path and an unsaved one with its text", () => {
    const kept = keptTabs(
      [
        tab({}),
        tab({ id: "b", path: "/n/b.md", content: "edited" }),
        tab({ id: "c", path: null, content: "draft", savedContent: "" }),
      ],
      "b",
      true,
    );
    expect(kept.active).toBe(1);
    expect(kept.tabs[0]).toEqual({ path: "/n/a.md" });
    expect(kept.tabs[1].text?.content).toBe("edited");
    expect(kept.tabs[2]).toMatchObject({
      path: null,
      text: { content: "draft" },
    });
  });

  it("keeps no text with draft recovery off, and no plugin views", () => {
    const kept = keptTabs(
      [
        tab({ content: "edited" }),
        tab({ id: "pdf", view: {} as unknown as DocTab["view"] }),
      ],
      "a",
      false,
    );
    expect(kept.tabs).toEqual([{ path: "/n/a.md" }]);
  });
});

describe("the kept tabs in sessionStorage", () => {
  it("come back as they were written", () => {
    const kept = keptTabs([tab({ content: "edited" })], "a", true);
    writeKeptTabs(kept);
    expect(readKeptTabs()).toEqual(kept);
  });

  it("are none in a new window", () => {
    expect(readKeptTabs()).toBeNull();
  });
});
