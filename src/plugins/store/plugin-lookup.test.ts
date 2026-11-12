import { describe, expect, it } from "vitest";
import { frontMatterKeys } from "./plugin-lookup";

describe("frontMatterKeys", () => {
  it("reads a front matter as the app does, a fence with trailing spaces too", () => {
    expect(
      frontMatterKeys("--- \nkanban-plugin: board\n---\n## To do"),
    ).toEqual(["kanban-plugin"]);
    expect(frontMatterKeys("# No front matter")).toEqual([]);
  });
});
