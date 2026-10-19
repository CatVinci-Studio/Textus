import { describe, expect, it } from "vitest";
import { groupByProject } from "./ChatHistoryMenu";
import type { ChatHistoryEntry } from "./chat-history";

const entry = (id: string, docPath: string | null, updatedAt: number) =>
  ({ id, docPath, title: id, updatedAt, turns: [] }) as ChatHistoryEntry;

describe("groupByProject", () => {
  it("groups by document folder, most recent group and entry first", () => {
    const groups = groupByProject([
      entry("a", "/novel/ch1.md", 1),
      entry("b", "/notes/x.md", 5),
      entry("c", "/novel/ch2.md", 3),
      entry("d", null, 2),
    ]);
    expect(groups.map((g) => g.folder)).toEqual(["/notes", "/novel", null]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(["c", "a"]);
  });
});
