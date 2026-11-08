import { describe, expect, it } from "vitest";
import { projectDocument } from "./start-project";

const entry = (name: string, is_dir = false) => ({
  name,
  path: `/p/${name}`,
  is_dir,
});

describe("the document a project opens with from the start page", () => {
  it("is the last one opened in it", () => {
    expect(
      projectDocument(
        "/p/",
        ["/q/x.md", "/p/notes/b.md", "/p/a.md"],
        [entry("README.md")],
      ),
    ).toBe("/p/notes/b.md");
  });

  it("else its README, else its first note by name", () => {
    expect(
      projectDocument(
        "/p",
        [],
        [entry("b.md"), entry("Readme.md"), entry("a.png")],
      ),
    ).toBe("/p/Readme.md");
    expect(
      projectDocument(
        "/p",
        [],
        [entry("Week 10.md"), entry("Week 2.md"), entry("docs", true)],
      ),
    ).toBe("/p/Week 2.md");
    expect(projectDocument("/p", [], [entry("pic.png")])).toBeNull();
  });
});
