import { describe, expect, it } from "vitest";
import { fileAction, fileKindOf, type DropFacts } from "./drop-route";

const isDocument = (path: string) => /\.(md|txt)$/.test(path);

describe("what a dragged file is", () => {
  it("is a picture, a note, a folder or else a file to link", () => {
    expect(fileKindOf("/n/boat.PNG", false, isDocument)).toBe("image");
    expect(fileKindOf("/n/map.svg", false, isDocument)).toBe("image");
    expect(fileKindOf("/n/Week 45.md", false, isDocument)).toBe("note");
    expect(fileKindOf("/n/report.pdf", false, isDocument)).toBe("attachment");
    expect(fileKindOf("/n/budget.xlsx", false, isDocument)).toBe("attachment");
    expect(fileKindOf("/n/clip.mov", false, isDocument)).toBe("attachment");
    // A folder by what it is, not by its name.
    expect(fileKindOf("/n/my.project", true, isDocument)).toBe("folder");
  });
});

describe("what a drop does with a file", () => {
  const body: DropFacts = {
    place: "body",
    shift: false,
    canInsert: true,
    claimed: false,
  };

  it("puts pictures and other files into a document's body, opens a note", () => {
    expect(fileAction("image", body)).toBe("insert");
    expect(fileAction("attachment", body)).toBe("insert");
    expect(fileAction("note", body)).toBe("open");
    expect(fileAction("folder", body)).toBe("folder");
  });

  it("opens whatever it is with Shift held", () => {
    const shift = { ...body, shift: true };
    expect(fileAction("image", shift)).toBe("open");
    expect(fileAction("attachment", shift)).toBe("open");
    expect(fileAction("note", shift)).toBe("open");
  });

  it("opens on a document's edge or a tab row", () => {
    for (const place of ["edge", "bar"] as const) {
      expect(fileAction("image", { ...body, place })).toBe("open");
      expect(fileAction("attachment", { ...body, place })).toBe("open");
    }
    expect(fileAction("folder", { ...body, place: "edge" })).toBe("folder");
  });

  it("opens what the document can't take (never saved, read-only)", () => {
    const cant = { ...body, canInsert: false };
    expect(fileAction("image", cant)).toBe("open");
    expect(fileAction("attachment", cant)).toBe("open");
  });

  it("puts in a note a plugin writes, but Shift still opens it", () => {
    const claimed = { ...body, claimed: true };
    expect(fileAction("note", claimed)).toBe("insert");
    expect(fileAction("note", { ...claimed, shift: true })).toBe("open");
  });
});
