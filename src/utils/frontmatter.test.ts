import { describe, expect, it } from "vitest";
import cases from "./frontmatter-cases.json";
import { splitFrontmatter } from "./frontmatter";

// The backend's readers take the same cases.
describe("splitFrontmatter", () => {
  for (const c of cases)
    it(c.name, () => {
      expect(splitFrontmatter(c.text)).toEqual({ yaml: c.yaml, body: c.body });
    });
});
