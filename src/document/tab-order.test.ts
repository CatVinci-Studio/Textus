// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const NEW = "/var/mobile/Containers/Data/Application/NEW/Documents";
const OLD = "/var/mobile/Containers/Data/Application/OLD/Documents";
vi.mock("@tauri-apps/api/path", () => ({
  documentDir: async () => NEW,
}));

const { readTabOrder, writeTabOrder } = await import("./tab-order");
const { documentsDir } = await import("../platform/documents-path");

afterEach(() => localStorage.clear());

describe("the tab order across a reinstall", () => {
  it("keeps documents by their place in Documents and finds them in the new one", async () => {
    await documentsDir();
    writeTabOrder(
      [
        { path: `${NEW}/Notes/a.md` },
        { id: "d1", path: null, text: "x" },
        // A database a plugin shows: kept by its file, to be opened again.
        {
          path: null,
          view: { kind: "editor", view: "db", resource: `${NEW}/all.base` },
        },
        { path: null, view: { kind: "page", view: "ai" } },
      ],
      0,
    );
    const stored = JSON.parse(localStorage.getItem("textus-tab-order")!);
    expect(stored.keys[0]).toBe("path:documents:Notes/a.md");
    expect(stored.keys.slice(2)).toEqual([
      "path:documents:all.base",
      "view:ai",
    ]);
    const docs = "/var/mobile/Containers/Data/Application/LATER/Documents/";
    expect(readTabOrder(docs)).toEqual({
      keys: [
        "path:/var/mobile/Containers/Data/Application/LATER/Documents/Notes/a.md",
        "id:d1",
        "path:/var/mobile/Containers/Data/Application/LATER/Documents/all.base",
        "view:ai",
      ],
      active:
        "path:/var/mobile/Containers/Data/Application/LATER/Documents/Notes/a.md",
    });
  });

  it("moves an older build's whole path into this install's Documents", () => {
    localStorage.setItem(
      "textus-tab-order",
      JSON.stringify({ keys: [`path:${OLD}/b.md`], active: "" }),
    );
    expect(readTabOrder(`${NEW}/`).keys).toEqual([`path:${NEW}/b.md`]);
  });
});
