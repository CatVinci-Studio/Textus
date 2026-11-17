import { expect, it } from "vitest";
import { folderTabsToClose } from "./close-folder";
import type { DocTab } from "../document/doc-tabs";

const tab = (id: string, path: string | null, dirty = false) =>
  ({
    id,
    path,
    content: dirty ? "typed" : "",
    savedContent: "",
  }) as DocTab;

it("closes the folder's saved documents and keeps unsaved ones and the rest", () => {
  const tabs = [
    tab("a", "/w/notes/a.md"),
    tab("b", "/w/notes/sub/b.md", true),
    tab("c", "/w/other.md"),
    tab("d", "/w/notes-2/d.md"),
    tab("e", null),
    // A plugin's page of a file in the folder (a .base) goes with it.
    { ...tab("f", null), view: { resource: "/w/notes/all.base" } } as DocTab,
  ];
  expect(folderTabsToClose(tabs, "/w/notes")).toEqual({
    close: ["a", "f"],
    blank: false,
  });
});

it("asks for a blank tab when every tab would close, so the window stays", () => {
  expect(folderTabsToClose([tab("a", "/w/a.md")], "/w")).toEqual({
    close: ["a"],
    blank: true,
  });
  expect(folderTabsToClose([tab("a", "/x/a.md")], "/w").blank).toBe(false);
});
