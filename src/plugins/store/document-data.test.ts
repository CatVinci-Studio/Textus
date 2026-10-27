import { describe, expect, it } from "vitest";
import { movedDocumentKey } from "./document-data";

describe("movedDocumentKey", () => {
  it("moves a document's own key", () => {
    expect(movedDocumentKey("doc:/w/a.md", "/w/a.md", "/w/b.md")).toBe(
      "doc:/w/b.md",
    );
  });

  it("moves the keys of a folder's documents, either separator", () => {
    expect(movedDocumentKey("doc:/w/notes/a.md", "/w/notes", "/w/old")).toBe(
      "doc:/w/old/a.md",
    );
    expect(movedDocumentKey("doc:C:\\w\\n\\a.md", "C:\\w\\n", "C:\\w\\m")).toBe(
      "doc:C:\\w\\m\\a.md",
    );
  });

  it("leaves other keys, and a name that only starts the same", () => {
    expect(movedDocumentKey("doc:/w/notes2/a.md", "/w/notes", "/x")).toBeNull();
    expect(movedDocumentKey("count", "/w/a.md", "/w/b.md")).toBeNull();
  });
});
