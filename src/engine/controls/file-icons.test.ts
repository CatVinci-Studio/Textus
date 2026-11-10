import { expect, it } from "vitest";
import { fileIconFor, fileKind } from "./file-icons";
import { GenericFileIcon } from "./icons";

it("knows a file's kind by its extension, in any case", () => {
  expect(fileKind("Plans.base")).toBe("table");
  expect(fileKind("board.CANVAS")).toBe("canvas");
  expect(fileKind("paper.pdf")).toBe("pdf");
  expect(fileKind("notes.md")).toBe("markdown");
  expect(fileKind("archive.tar.gz")).toBe("archive");
  expect(fileKind("README")).toBeNull();
});

it("gives an unknown kind the plain file icon, a known one its own", () => {
  expect(fileIconFor("x.unknown")).toBe(GenericFileIcon);
  expect(fileIconFor("x.base")).not.toBe(GenericFileIcon);
  expect(fileIconFor("x.base")).not.toBe(fileIconFor("x.pdf"));
});

it("sizes each icon as a whole, never a shape inside it", async () => {
  // A size on a shape is in the icon's own units: scaled, it runs past the
  // edge and is cut off (a Markdown file's frame drawn as one corner).
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./icons.tsx", import.meta.url), "utf8");
  const inner = [...source.matchAll(/<(\w+)[^<>]*?style=\{iconSize/gs)]
    .map((m) => m[1])
    // A Lucide component (capitalised) is the svg itself.
    .filter((tag) => tag !== "svg" && !/^[A-Z]/.test(tag));
  expect(inner).toEqual([]);
});
