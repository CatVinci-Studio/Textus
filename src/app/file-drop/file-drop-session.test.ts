import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDropTarget } from "../../engine/controls/document-drop";

const doc = vi.hoisted(() => ({
  target: null as FileDropTarget | null,
  filled: [] as string[][],
}));
const plugin = vi.hoisted(() => ({ claims: new Set<string>() }));
/** The zone under the pointer, by x: off the documents left of 0, on the
 *  left edge up to 20, the body after. */
const zoneAt = (x: number) =>
  x < 0 ? null : x < 20 ? "left" : ("center" as const);

vi.mock("../../engine/layout/drop-zones", () => ({
  dropGeometry: () => ({
    bars: [],
    panes: [
      { tabId: "t1", rect: { left: 0, right: 500, top: 0, bottom: 500 } },
    ],
  }),
  barDropAt: () => null,
  dropTargetAt: (x: number) => {
    const zone = zoneAt(x);
    return zone && { zone, tabId: "t1", rect: {} };
  },
}));
vi.mock("../../engine/layout/store", () => ({
  paneOf: () => "p1",
  shownIsland: () => null,
  windowLayout: () => ({}),
}));
vi.mock("../../engine/controls/tabs/incoming-tab", () => ({
  setIncomingTab: () => {},
}));
const split = vi.hoisted(() => ({ shown: [] as string[] }));
vi.mock("../islands/split-drop", () => ({
  arrivalPreview: () => ({
    clear() {},
    // Only a split: a body with no tab row shows "center".
    show: (_x: number, _y: number, target: { zone: string }) =>
      target.zone !== "center" && split.shown.push(target.zone),
    take: () => null,
  }),
}));
vi.mock("../../platform/ipc", () => ({
  fs: { pictureSize: () => Promise.resolve(null) },
}));
vi.mock("../../plugins/contributions/drop-handlers", () => ({
  dropClaimed: (name: string) => plugin.claims.has(name),
  // The plugin that claimed it gives nothing for it.
  provideDrop: () => Promise.resolve(null),
}));
vi.mock("../../engine/controls/document-drop", () => ({
  fileRooms: () => ({
    targetIn: () => doc.target,
    show: () => true,
    clear() {},
    async fill(produce: (target: FileDropTarget) => Promise<string[]>) {
      doc.filled.push(await produce(doc.target!));
      return true;
    },
  }),
}));

import { fileDropOnDocuments } from "./file-drop-session";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function session(open: (path: string, first: boolean) => Promise<void>) {
  return fileDropOnDocuments({
    open: (path, _target, first) => open(path, first),
    openFolder: () => {},
    linkRoot: () => null,
    hints: () => ({ image: "", link: "" }),
    failed: () => {},
  });
}

describe("files let go on a document", () => {
  beforeEach(() => {
    doc.target = null;
    doc.filled = [];
    plugin.claims.clear();
  });

  it("open one after another, in the order dropped, only the first as first", async () => {
    const opened: [string, boolean][] = [];
    let finishFirst = () => {};
    const drop = session((path, first) => {
      opened.push([path, first]);
      return path.endsWith("a.md")
        ? new Promise<void>((resolve) => (finishFirst = resolve))
        : Promise.resolve();
    });
    const files = ["/d/a.md", "/d/b.md"].map((path) => ({
      path,
      isDir: false,
      fromSystem: true,
    }));
    expect(drop.drop(files, 100, 10, false)).toBe(true);
    await flush();
    // The second waits for the first, however long it takes to read.
    expect(opened).toEqual([["/d/a.md", true]]);
    finishFirst();
    await flush();
    expect(opened).toEqual([
      ["/d/a.md", true],
      ["/d/b.md", false],
    ]);
  });

  it("a plugin's file it then declines, in a draft, opens instead of being lost", async () => {
    doc.target = {
      docPath: null,
      imageFolder: "assets",
      storeImage: () => Promise.resolve(null),
    };
    plugin.claims.add("data.csv");
    const opened: string[] = [];
    const drop = session((path) => {
      opened.push(path);
      return Promise.resolve();
    });
    drop.drop([{ path: "/d/data.csv", isDir: false }], 100, 10, false);
    await vi.waitFor(() => expect(doc.filled).toEqual([[]]));
    await flush();
    expect(opened).toEqual(["/d/data.csv"]);
  });
});

describe("a note dragged onto the documents", () => {
  const note = [{ path: "/d/a.md", isDir: false }];
  beforeEach(() => {
    split.shown = [];
    doc.target = null;
  });

  it("passes over the edge it comes in by without the islands making room", () => {
    const drop = session(() => Promise.resolve());
    drop.over(note, -5, 10, false);
    drop.over(note, 10, 10, false);
    drop.over(note, 100, 10, false);
    expect(split.shown).toEqual([]);
    // Back on the edge from the body, it splits.
    drop.over(note, 10, 10, false);
    expect(split.shown).toEqual(["left"]);
    drop.leave();
  });
});
