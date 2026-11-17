import { describe, expect, it } from "vitest";
import { formatsIn } from "./tutorial-evaluation";

describe("formatsIn", () => {
  it.each([
    ["# Title", "heading"],
    ["### Part", "heading"],
    ["- item", "list"],
    ["* item", "list"],
    ["1. first", "numbered"],
    ["2) second", "numbered"],
    ["- [ ] call back", "task"],
    ["- [x] done", "task"],
  ])("sees %s as %s", (line, kind) =>
    expect(formatsIn(`plain\n${line}`)).toEqual([kind]),
  );

  it.each(["", "plain text", "#hashtag", "- ", "1.5 litres", "- [ ] "])(
    "not %s",
    (text) => expect(formatsIn(text)).toEqual([]),
  );

  it("sees every kind once, in the order asked", () => {
    expect(formatsIn("- [ ] a\n1. b\n- c\n# d\n- e")).toEqual([
      "heading",
      "list",
      "numbered",
      "task",
    ]);
  });
});
