import { describe, expect, it, vi } from "vitest";
import { isDocumentName, textFileOf } from "./document-name";

vi.mock("../plugins/store/plugin-records", () => ({
  pluginsSnapshot: () => [],
  runningPlugins: () => [
    {
      manifest: {
        contributes: {
          documentTypes: [],
          textFiles: [{ extensions: ["tex", "bib"], language: "latex" }],
        },
      },
    },
  ],
}));

describe("what a file opens as", () => {
  it("shows text that isn't a document as plain text, editable once a plugin takes it", () => {
    expect(textFileOf("/notes/a.md")).toBeNull();
    expect(textFileOf(null)).toBeNull();
    expect(textFileOf("/paper/main.TEX")).toEqual({
      language: "latex",
      claimed: true,
    });
    expect(textFileOf("/site/config.yaml")).toEqual({
      language: null,
      claimed: false,
    });
    // Still not a document: kept out of the Markdown index and its saves.
    expect(isDocumentName("refs.bib")).toBe(false);
  });
});
