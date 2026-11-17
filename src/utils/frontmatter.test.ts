import { describe, expect, it } from "vitest";
import cases from "./frontmatter-cases.json";
import {
  parseFrontmatter,
  splitFrontmatter,
  withFrontmatter,
} from "./frontmatter";
import {
  parseYamlFull,
  readFrontmatterFull,
  stringifyYamlFull,
  writeFrontmatterFull,
} from "./frontmatter-yaml";

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

describe("front matter read and written in full, for plugins", () => {
  const doc = [
    "---",
    "# kept",
    "title: 'Rain'",
    "notes: |",
    "  two lines",
    "  of text",
    "people:",
    "  - name: Ada",
    "    role: author # the first",
    "status: draft",
    "---",
    "Body",
  ].join("\n");

  it("reads block text and lists of maps as YAML means them", () => {
    expect(readFrontmatterFull(doc)).toEqual({
      title: "Rain",
      notes: "two lines\nof text\n",
      people: [{ name: "Ada", role: "author" }],
      status: "draft",
    });
    expect(readFrontmatterFull("Body")).toEqual({});
  });

  it("changes one key and keeps comments, quoting and the rest", () => {
    const data = readFrontmatterFull(doc);
    const out = writeFrontmatterFull(doc, { ...data, status: "done" });
    expect(out).toBe(doc.replace("status: draft", "status: done"));
  });

  it("removes a gone key and adds a new one at the end", () => {
    const data = readFrontmatterFull(doc);
    delete data.status;
    const out = writeFrontmatterFull(doc, { ...data, tags: ["a", "b"] });
    expect(out).not.toContain("status:");
    expect(readFrontmatterFull(out).tags).toEqual(["a", "b"]);
    expect(out).toContain("# the first");
  });

  it("falls back to the light reader for YAML it can't read", () => {
    const broken = "---\ntitle: [unclosed\n---\nBody";
    expect(readFrontmatterFull(broken)).toEqual(parseFrontmatter(broken));
  });

  it("parses and writes YAML text", () => {
    expect(parseYamlFull("a: 1\nb: [x, y]")).toEqual({ a: 1, b: ["x", "y"] });
    expect(parseYamlFull("- a")).toEqual({});
    expect(stringifyYamlFull({ a: "x: y" })).toBe('a: "x: y"');
  });
});
