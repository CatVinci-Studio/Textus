import { expect, it } from "vitest";
import { historyHandlers, stopPluginHistory } from "./broker-history";
import type { PluginScope } from "./broker-scope";

const scope = (
  id: string,
  answer: (method: string, params: unknown) => unknown,
) =>
  ({
    id,
    request: async (m: string, p: unknown) => answer(m, p),
  }) as unknown as PluginScope;

it("lists a plugin's history source and reads it for another, newest first", async () => {
  const git = historyHandlers(
    scope("a.git", (method, params) =>
      method === "$historyVersions"
        ? [
            { id: "c1", at: "2026-11-01T10:00:00Z", label: "First" },
            { id: "c2", at: "2026-11-02T10:00:00Z", author: "Ada" },
            { id: "", at: "2026-11-03T10:00:00Z" },
            { id: "c4", at: "not a date" },
          ]
        : `text of ${(params as { version: string }).version}`,
    ),
  );
  git["history.registerSource"]({ id: "commits", label: "Git" });
  const reader = historyHandlers(scope("a.history", () => null));
  expect(reader["history.sources"]()).toEqual([
    { id: "a.git/commits", label: "Git", plugin: "a.git" },
  ]);
  await expect(
    reader["history.versions"]({ source: "a.git/commits", path: "a.md" }),
  ).resolves.toEqual([
    { id: "c2", at: "2026-11-02T10:00:00Z", author: "Ada" },
    { id: "c1", at: "2026-11-01T10:00:00Z", label: "First" },
  ]);
  await expect(
    reader["history.read"]({
      source: "a.git/commits",
      path: "a.md",
      version: "c1",
    }),
  ).resolves.toBe("text of c1");
  stopPluginHistory("a.git");
  expect(reader["history.sources"]()).toEqual([]);
  await expect(
    reader["history.versions"]({ source: "a.git/commits", path: "a.md" }),
  ).rejects.toThrow("No history source a.git/commits.");
});
