import { describe, expect, it } from "vitest";
import type { DocTab } from "../document/doc-tabs";
import { documentToLinkFrom, fileLinkSource } from "./link-to-file";
import { pathIndex } from "./link-resolve";

const paths = pathIndex("/v", ["/v/notes/Today.md", "/v/assets/a b.png"]);
const linkTo = (path: string, wiki: boolean) =>
  fileLinkSource(paths, path, "/v/notes/Today.md", {
    wiki,
    format: wiki ? "shortest" : "relative",
  });

describe("a link to a file from the tree", () => {
  it("is a picture for an image, in either link style", () => {
    expect(linkTo("/v/assets/a b.png", false)).toBe("![](../assets/a%20b.png)");
    expect(linkTo("/v/assets/a b.png", true)).toBe("![[a b.png]]");
  });

  it("keeps a picture whose name has brackets whole", () => {
    const shot = "/v/shot [1].png";
    const link = fileLinkSource(
      pathIndex("/v", [shot, "/v/notes/Today.md"]),
      shot,
      "/v/notes/Today.md",
      { wiki: false, format: "relative" },
    );
    expect(link.startsWith("![](")).toBe(true);
    expect(link).toContain("shot");
    expect(link.endsWith(")")).toBe(true);
  });

  it("is a link for anything else, a file's named with its extension", () => {
    expect(linkTo("/v/notes/Today.md", false)).toBe("[Today](Today.md)");
    const pdf = "/v/report.pdf";
    const linkToPdf = (wiki: boolean) =>
      fileLinkSource(
        pathIndex("/v", [pdf, "/v/notes/Today.md"]),
        pdf,
        "/v/notes/Today.md",
        { wiki, format: wiki ? "shortest" : "relative" },
      );
    expect(linkToPdf(false)).toBe("[report.pdf](../report.pdf)");
    expect(linkToPdf(true)).toBe("[[report.pdf]]");
  });

  it("goes only into a saved note open to writing", () => {
    const tab = (over: Partial<DocTab>) =>
      [{ id: "t", path: "/v/a.md", ...over }] as DocTab[];
    expect(documentToLinkFrom(tab({}), "t")).toBe("/v/a.md");
    expect(documentToLinkFrom(tab({}), "other")).toBeNull();
    expect(documentToLinkFrom(tab({ path: null }), "t")).toBeNull();
    expect(documentToLinkFrom(tab({ readOnly: true }), "t")).toBeNull();
    expect(documentToLinkFrom(tab({ path: "/v/r.pdf" }), "t")).toBeNull();
  });
});
