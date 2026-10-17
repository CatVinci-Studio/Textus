import { describe, expect, it } from "vitest";
import { exportFilename, fileKind, readMarkdownFile } from "./markdown-file";

describe("a file picked or dropped on the playground", () => {
  it("is imported when it is Markdown or plain text", () => {
    for (const name of ["notes.md", "README.MARKDOWN", "todo.txt"])
      expect(fileKind({ name, type: "" }), name).toBe("markdown");
  });

  it("is an image by its type or its name", () => {
    expect(fileKind({ name: "image.png", type: "image/png" })).toBe("image");
    expect(fileKind({ name: "", type: "image/jpeg" })).toBe("image");
    expect(fileKind({ name: "photo.JPG", type: "" })).toBe("image");
  });

  it("is turned away otherwise", () => {
    expect(fileKind({ name: "report.pdf", type: "application/pdf" })).toBe(
      "other",
    );
    expect(fileKind({ name: "notes.md.zip", type: "" })).toBe("other");
  });

  it("is read without its BOM and with plain line breaks", async () => {
    const file = new Blob(["﻿# Title\r\n\r\nText\r\n"]);
    expect(await readMarkdownFile(file)).toBe("# Title\n\nText\n");
  });
});

describe("an exported document", () => {
  it("is named after its first heading", () => {
    expect(exportFilename("# Trip: Kyoto/Osaka\n\nDay one", "Untitled")).toBe(
      "Trip- Kyoto-Osaka.md",
    );
  });

  it("falls back when there is nothing to name it after", () => {
    expect(exportFilename("", "Untitled")).toBe("Untitled.md");
  });
});
