import { describe, expect, it, vi } from "vitest";

const calls: unknown[][] = [];
vi.mock("../../platform/ipc", () => ({
  fs: {
    conventionReaders: async (list: unknown) =>
      void calls.push(["readers", list]),
    conventionsPending: async () => [
      { app: "a.zettel#zettel", root: "/w", text: "days=journal" },
      { app: "b.gone#x", root: "/w", text: "" },
    ],
    conventionsAnswer: async (...args: unknown[]) =>
      void calls.push(["answer", ...args]),
  },
}));

const { conventionReaderHandlers } = await import("./broker-conventions");
const { readPendingConventions, stopPluginConventionReaders } =
  await import("../contributions/convention-readers");
const { conventionsAppName } = await import("../../prefs/image-folder");
import type { PluginScope } from "./broker-scope";

describe("convention readers", () => {
  it("are handed their marker's text, their answer passed on, and go with their plugin", async () => {
    const asked: unknown[] = [];
    const handlers = conventionReaderHandlers({
      id: "a.zettel",
      request: async (method: string, params: unknown) => {
        asked.push([method, params]);
        return { linkStyle: "wiki" };
      },
    } as unknown as PluginScope);
    handlers["files.registerConventionReader"]({
      id: "zettel",
      label: "Zettel",
      marker: "zettel/zettel.cfg",
      notes: true,
    });
    expect(conventionsAppName("a.zettel#zettel")).toBe("Zettel");
    await readPendingConventions("/w/notes");
    expect(calls).toContainEqual([
      "readers",
      [{ app: "a.zettel#zettel", marker: "zettel/zettel.cfg", notes: true }],
    ]);
    expect(asked).toEqual([
      ["$conventionRead", { id: "zettel", root: "/w", text: "days=journal" }],
    ]);
    // A marker no reader here knows is left for its own window.
    expect(calls.filter((c) => c[0] === "answer")).toEqual([
      [
        "answer",
        "a.zettel#zettel",
        "/w",
        "days=journal",
        { linkStyle: "wiki" },
      ],
    ]);
    stopPluginConventionReaders("a.zettel");
    expect(calls.at(-1)).toEqual(["readers", []]);
    expect(conventionsAppName("a.zettel#zettel")).toBe("a.zettel#zettel");
  });
});
