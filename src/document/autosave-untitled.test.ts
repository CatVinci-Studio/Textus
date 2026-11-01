import { describe, expect, it } from "vitest";
import {
  freeFilePath,
  joinFile,
  numberedFilename,
  untitledAutosavable,
  untitledFolder,
} from "./autosave-untitled";
import type { DocTab } from "./doc-tabs";

const draft: DocTab = {
  id: "a",
  path: null,
  content: "# Notes\n",
  savedContent: "",
  diskMtime: null,
  sourceMode: false,
  reloadKey: 0,
};

describe("which untitled tabs autosave gives a file", () => {
  it("takes a plain draft with text in it", () => {
    expect(untitledAutosavable(draft)).toBe(true);
  });
  it("never takes an empty or whitespace-only draft", () => {
    expect(untitledAutosavable({ ...draft, content: "" })).toBe(false);
    expect(untitledAutosavable({ ...draft, content: " \n\t\n" })).toBe(false);
  });
  it("leaves guides, Word imports and documents with a file alone", () => {
    expect(untitledAutosavable({ ...draft, helpDoc: "markdown" })).toBe(false);
    expect(untitledAutosavable({ ...draft, importedFrom: "/w/a.docx" })).toBe(
      false,
    );
    expect(untitledAutosavable({ ...draft, path: "/n/a.md" })).toBe(false);
  });
});

describe("the folder an untitled document is autosaved into", () => {
  const documents = () => Promise.resolve("/home/me/Documents");
  it("is the folder open in the window first", async () => {
    expect(await untitledFolder("/work", documents)).toBe("/work");
  });
  it("is Documents with no folder open", async () => {
    expect(await untitledFolder(null, documents)).toBe("/home/me/Documents");
  });
  it("is nowhere when there is no Documents folder either", async () => {
    const none = () => Promise.reject(new Error("unknown"));
    expect(await untitledFolder(null, none)).toBeNull();
  });
});

describe("numbered file names", () => {
  it("keeps the first and numbers the rest before the extension", () => {
    expect(numberedFilename("Notes.md", 1)).toBe("Notes.md");
    expect(numberedFilename("Notes.md", 2)).toBe("Notes 2.md");
    expect(numberedFilename("v1.2 plan.md", 3)).toBe("v1.2 plan 3.md");
  });
});

describe("joinFile", () => {
  it("uses the separator the folder is written with", () => {
    expect(joinFile("/docs/", "a.md")).toBe("/docs/a.md");
    expect(joinFile("C:\\Users\\me\\Documents", "a.md")).toBe(
      "C:\\Users\\me\\Documents\\a.md",
    );
  });
});

describe("freeFilePath", () => {
  it("numbers the name rather than overwriting a file", async () => {
    const taken = new Set(["/docs/Notes.md", "/docs/Notes 2.md"]);
    const path = await freeFilePath("/docs", "Notes.md", async (p) =>
      taken.has(p),
    );
    expect(path).toBe("/docs/Notes 3.md");
  });
  it("gives up rather than looping forever", async () => {
    expect(await freeFilePath("/docs", "a.md", async () => true)).toBeNull();
  });
});
