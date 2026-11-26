// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeViews, openView } from "../editor/editor-view-kit";
import { createTestEditor } from "../editor/editor-test-kit";
import { fs } from "../platform/ipc";
import { undoFiles } from "../platform/ipc-files";
import { setWindowFolderSource } from "../platform/window-folder";
import { registerPathCompletion, targetItems } from "./path-completion";

// A saved document's pictures load through Tauri, which jsdom hasn't.
vi.mock("../platform/file-src", () => ({ fileSrc: () => "about:blank" }));

const files = [
  "/v/notes/Today.md",
  "/v/notes/Plan.md",
  "/v/assets/a b.png",
  "/v/assets/logo.svg",
  "/v/Inbox.md",
  "/v/report.pdf",
].map((path) => ({ path, rel: path.slice(3) }));

describe("a target lists the folder's files by their path from the document", () => {
  const labels = (kind: "image" | "link") =>
    targetItems(files, "/v", "/v/notes/Today.md", kind).map((i) => i.label);

  it("a picture's only images", () => {
    expect(labels("image")).toEqual([
      "../assets/a b.png",
      "../assets/logo.svg",
    ]);
  });

  it("a link's every file, notes first, the document itself left out", () => {
    expect(labels("link")).toEqual([
      "Plan.md",
      "../Inbox.md",
      "../assets/a b.png",
      "../assets/logo.svg",
      "../report.pdf",
    ]);
  });

  it("each path escaped as Textus writes link paths, found as typed either way", () => {
    const [spaced] = targetItems(files, "/v", "/v/notes/Today.md", "image");
    expect(spaced.insert).toBe("(../assets/a%20b.png");
    expect(spaced.keywords).toBe("../assets/a%20b.png");
    const [beside] = targetItems(files, "/v", "/v/notes/Today.md", "link");
    expect(beside.keywords).toBe("./Plan.md");
  });
});

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

let stop: (() => void) | null = null;
afterEach(async () => {
  stop?.();
  stop = null;
  setWindowFolderSource(null);
  await closeViews();
  vi.restoreAllMocks();
});

const panel = () =>
  document.querySelector<HTMLElement>(".completion-list:not([hidden])");
const rows = () =>
  [...(panel()?.querySelectorAll(".completion-label") ?? [])].map(
    (el) => el.textContent,
  );
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function editorAt(docPath: string | null, markdown = "") {
  vi.spyOn(fs, "indexFolder").mockResolvedValue({ files, truncated: false });
  // A saved document keeps its undo history in a file: none here.
  vi.spyOn(undoFiles, "load").mockResolvedValue(null as never);
  vi.spyOn(undoFiles, "save").mockResolvedValue(undefined as never);
  setWindowFolderSource(() => "/v");
  stop = registerPathCompletion({ image: () => "Images", link: () => "Files" });
  return openView(markdown, {}, (text, settings) =>
    createTestEditor(text, settings, docPath),
  );
}

describe("typing a target in the rich editor", () => {
  it("lists images after ![](, filters as typed, and a pick makes the picture", async () => {
    const t = await editorAt("/v/notes/Today.md");
    t.type("![](");
    await settle();
    expect(rows()).toEqual(["../assets/a b.png", "../assets/logo.svg"]);
    t.type("../assets/a");
    expect(rows()).toEqual(["../assets/a b.png"]);
    expect(t.press("Enter")).toBe(true);
    expect(t.markdown()).toBe("![](../assets/a%20b.png)");
    let images = 0;
    t.view.state.doc.descendants((node) => {
      if (node.type.name === "image") images++;
    });
    expect(images).toBe(1);
  });

  it("lists notes first after [text](, and the pick is one undo step", async () => {
    const t = await editorAt("/v/notes/Today.md");
    t.type("see [plan](");
    await settle();
    expect(rows()[0]).toBe("Plan.md");
    t.press("Enter");
    expect(t.markdown()).toBe("see [plan](Plan.md)");
    t.press("Mod+z");
    expect(t.caretLine()).toBe("see [plan](|)");
  });

  it("lists paths again where an existing link's target is retyped", async () => {
    const t = await editorAt("/v/notes/Today.md", "see [plan](old.md) now");
    expect(t.view.state.doc.firstChild?.child(1).type.name).toBe("link");
    t.caretAt("[plan](old.md)", 7, 6);
    t.type("P");
    await settle();
    expect(rows()[0]).toBe("Plan.md");
    t.press("Enter");
    expect(t.markdown()).toBe("see [plan](Plan.md) now");
  });

  it("offers nothing in an unsaved document", async () => {
    const t = await editorAt(null);
    t.type("![](");
    await settle();
    expect(panel()).toBeNull();
  });
});
