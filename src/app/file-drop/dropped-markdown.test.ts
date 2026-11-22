import { describe, expect, it } from "vitest";
import { pathIndex } from "../../files/link-resolve";
import { folderFileLink } from "./dropped-markdown";

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
