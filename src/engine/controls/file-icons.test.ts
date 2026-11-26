import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileIcon, fileIconFor, fileKind } from "./file-icons";
import {
  setFileIconTheme,
  themedIconUrl,
  type IconTable,
} from "./file-icon-theme";
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

describe("a file icon theme", () => {
  const table: IconTable = {
    fileNames: new Map([["readme.md", "u:readme"]]),
    fileExtensions: new Map([
      ["md", "u:md"],
      ["ts", "u:ts"],
      ["d.ts", "u:dts"],
    ]),
    folderNames: new Map([["docs", "u:docs"]]),
    folderNamesExpanded: new Map([["docs", "u:docs-open"]]),
    file: "u:file",
    folder: "u:folder",
  };

  it("matches an exact name first, then the longest extension, in any case", () => {
    expect(themedIconUrl(table, "README.md", "file")).toBe("u:readme");
    expect(themedIconUrl(table, "/notes/Plan.MD", "file")).toBe("u:md");
    expect(themedIconUrl(table, "index.d.ts", "file")).toBe("u:dts");
    expect(themedIconUrl(table, "index.ts", "file")).toBe("u:ts");
    expect(themedIconUrl(table, "a.d.ts.bak", "file")).toBe("u:file");
  });

  it("names folders open and closed, else its defaults", () => {
    expect(themedIconUrl(table, "Docs", "folder")).toBe("u:docs");
    expect(themedIconUrl(table, "docs", "folderOpen")).toBe("u:docs-open");
    // No open folder of its own: the closed one.
    expect(themedIconUrl(table, "src", "folderOpen")).toBe("u:folder");
  });

  it("leaves the app's icon where the theme has none", () => {
    const bare = { ...table, file: undefined, folder: undefined };
    expect(themedIconUrl(bare, "x.unknown", "file")).toBeNull();
    expect(themedIconUrl(bare, "src", "folder")).toBeNull();
  });

  it("draws the theme's icon in a listing, and the app's again without it", () => {
    const draw = () =>
      renderToStaticMarkup(
        createElement(FileIcon, { name: "notes.md", className: "tree-icon" }),
      );
    setFileIconTheme({ dark: table, light: table });
    expect(draw()).toMatch(/<img[^>]*src="u:md"/);
    setFileIconTheme(null);
    expect(draw()).toMatch(/^<svg/);
  });
});
