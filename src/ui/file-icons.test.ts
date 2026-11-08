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
