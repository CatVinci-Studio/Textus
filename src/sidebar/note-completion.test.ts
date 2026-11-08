import { describe, expect, it } from "vitest";
import { noteItems } from "./note-completion";

const files = ["/v/Inbox.md", "/v/a/Idea.md", "/v/b/Idea.md"].map((path) => ({
  path,
  rel: path.slice(3),
}));
const inserts = (format: "shortest" | "relative" | "absolute", wiki = true) =>
  noteItems(files as never, "/v", "/v/a/Today.md", { wiki, format }).map(
    (i) => i.insert,
  );

describe("[[ lists the folder's notes", () => {
  it("as wiki links by the shortest name that finds each", () => {
    expect(inserts("shortest")).toEqual([
      "[[Inbox]]",
      "[[a/Idea|Idea]]",
      "[[b/Idea|Idea]]",
    ]);
  });

  it("in a vault's relative or absolute format", () => {
    expect(inserts("relative")).toEqual([
      "[[../Inbox|Inbox]]",
      "[[Idea]]",
      "[[../b/Idea|Idea]]",
    ]);
    expect(inserts("absolute")).toEqual([
      "[[Inbox]]",
      "[[a/Idea|Idea]]",
      "[[b/Idea|Idea]]",
    ]);
  });

  it("as standard links by their path where nothing says otherwise", () => {
    expect(inserts("relative", false)).toEqual([
      "[Inbox](../Inbox.md)",
      "[Idea](Idea.md)",
      "[Idea](../b/Idea.md)",
    ]);
  });
});
