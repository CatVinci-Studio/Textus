import { describe, expect, it } from "vitest";
import cases from "./frontmatter-cases.json";
import {
  parseFrontmatter,
  splitFrontmatter,
  withFrontmatter,
} from "./frontmatter";

// The backend's readers take the same cases.
describe("splitFrontmatter", () => {
  for (const c of cases)
    it(c.name, () => {
      expect(splitFrontmatter(c.text)).toEqual({ yaml: c.yaml, body: c.body });
    });
});

describe("withFrontmatter on a document that has some", () => {
  const doc = [
    "---",
    "# my notes",
    "status: draft",
    "description: |",
    "  Two lines",
    "  of text.",
    "authors:",
    "  - name: Ann",
    "    url: https://a.example",
    "---",
    "Body",
  ].join("\n");

  it("rewrites only the key that changed, the rest as written", () => {
    const data = { ...parseFrontmatter(doc), status: "done" };
    expect(withFrontmatter(doc, data)).toBe(
      doc.replace("status: draft", "status: done"),
    );
  });

  it("drops a key taken away and adds a new one at the end", () => {
    const data = parseFrontmatter(doc);
    delete data.status;
    const out = withFrontmatter(doc, { ...data, tags: ["a"] });
    expect(out).not.toContain("status:");
    expect(out).toContain("tags: [a]\n---\nBody");
    expect(out).toContain("  of text.");
  });

  it("quotes a list item with a comma, so it reads back as one", () => {
    const out = withFrontmatter("", { authors: ["Smith, John"] });
    expect(parseFrontmatter(out).authors).toEqual(["Smith, John"]);
  });
});
