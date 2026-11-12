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
    expect(kept.tabs[0]).toEqual({ id: "a", path: "/n/a.md" });
    expect(kept.tabs[1].text?.content).toBe("edited");
    expect(kept.tabs[2]).toMatchObject({
      path: null,
      text: { content: "draft" },
    });
  });

  it("keeps no text with draft recovery off, and a plugin view by what it shows", () => {
    const view = { plugin: "pdf", view: "reader", kind: "view" } as const;
    const kept = keptTabs(
      [tab({ content: "edited" }), tab({ id: "pdf", path: null, view })],
      "pdf",
      false,
    );
    expect(kept.tabs).toEqual([
      { id: "a", path: "/n/a.md" },
      { id: "pdf", path: null, view },
    ]);
    expect(kept.active).toBe(1);
  });
});

describe("the kept tabs in sessionStorage", () => {
  it("come back as they were written", () => {
    const kept = keptTabs([tab({ content: "edited" })], "a", true);
    writeKeptTabs(kept);
    expect(readKeptTabs()).toEqual(kept);
  });

  it("past the quota, go without text or id, so no draft is moved away", () => {
    const kept = keptTabs([tab({ content: "edited" })], "a", true);
    const set = Storage.prototype.setItem;
    let calls = 0;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (calls++ === 0) throw new DOMException("full", "QuotaExceededError");
      set.call(this, key, value);
    };
    try {
      writeKeptTabs(kept);
    } finally {
      Storage.prototype.setItem = set;
    }
    const back = readKeptTabs()!.tabs[0];
    expect([back.id, back.text]).toEqual([undefined, undefined]);
  });

  it("are none in a new window", () => {
    expect(readKeptTabs()).toBeNull();
  });
});
