import { afterEach, describe, expect, it } from "vitest";
import { pathIndex } from "../../files/link-resolve";
import {
  addDropHandler,
  dropMatch,
  forgetDropHandlers,
} from "../../plugins/contributions/drop-handlers";
import { droppedMarkdown, folderFileLink } from "./dropped-markdown";

const from = "/notes/Week 45/Monday.md";
const paths = (file: string) => pathIndex("/notes", [file, from]);

describe("a file of the folder dropped into a document", () => {
  it("is a picture by its path from the document, with no words", () => {
    const file = "/notes/assets/boat photo.png";
    expect(
      folderFileLink(
        paths(file),
        file,
        from,
        { wiki: false, format: "relative" },
        "image",
      ),
    ).toBe("![](../assets/boat%20photo.png)");
  });

  it("keeps a picture whose name has brackets whole", () => {
    const file = "/notes/shot [1].png";
    const link = folderFileLink(
      paths(file),
      file,
      from,
      { wiki: false, format: "relative" },
      "image",
    );
    expect(link.startsWith("![](")).toBe(true);
    expect(link).toContain("shot");
    expect(link.endsWith(")")).toBe(true);
  });

  it("is a link named as the file, extension and all", () => {
    const file = "/notes/report.pdf";
    expect(
      folderFileLink(
        paths(file),
        file,
        from,
        { wiki: false, format: "relative" },
        "attachment",
      ),
    ).toBe("[report.pdf](../report.pdf)");
  });

  it("is written as a vault writes links", () => {
    const image = "/notes/assets/boat.png";
    const pdf = "/notes/report.pdf";
    const wiki = { wiki: true, format: "shortest" } as const;
    expect(folderFileLink(paths(image), image, from, wiki, "image")).toBe(
      "![[boat.png]]",
    );
    expect(folderFileLink(paths(pdf), pdf, from, wiki, "attachment")).toBe(
      "[[report.pdf]]",
    );
  });
});

describe("a file a plugin writes", () => {
  afterEach(() => forgetDropHandlers("a.csv"));

  it("goes in as the plugin's Markdown, asked with what it is", async () => {
    const asked: unknown[] = [];
    addDropHandler(
      "a.csv",
      "1",
      dropMatch({ extensions: ["csv"] }),
      async (f) => {
        asked.push(f);
        return "| a | b |";
      },
    );
    const target = {
      docPath: "/notes/a.md",
      imageFolder: "assets",
      storeImage: async () => null,
    };
    expect(
      await droppedMarkdown(
        { path: "/d/rows.csv", kind: "attachment", fromSystem: true },
        target,
        "/notes",
      ),
    ).toBe("| a | b |");
    expect(asked).toEqual([
      {
        path: "/d/rows.csv",
        name: "rows.csv",
        kind: "attachment",
        fromSystem: true,
        document: "/notes/a.md",
      },
    ]);
  });
});
