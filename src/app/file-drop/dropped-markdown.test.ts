import { afterEach, describe, expect, it } from "vitest";
import {
  addDropHandler,
  dropMatch,
  forgetDropHandlers,
} from "../../plugins/contributions/drop-handlers";
import { droppedMarkdown } from "./dropped-markdown";

describe("a file a plugin writes", () => {
  afterEach(() => forgetDropHandlers("a.csv"));

  it("goes in as the plugin's Markdown, asked with what it is", async () => {
    const asked: unknown[] = [];
    addDropHandler(
      "a.csv",
      "1",
      dropMatch({ extensions: ["csv"] }),
      async (f) => {
        asked.push(f);
        return "| a | b |";
      },
    );
    const target = {
      docPath: "/notes/a.md",
      imageFolder: "assets",
      storeImage: async () => null,
    };
    expect(
      await droppedMarkdown(
        { path: "/d/rows.csv", kind: "attachment", fromSystem: true },
        target,
        "/notes",
      ),
    ).toBe("| a | b |");
    expect(asked).toEqual([
      {
        path: "/d/rows.csv",
        name: "rows.csv",
        kind: "attachment",
        fromSystem: true,
        document: "/notes/a.md",
      },
    ]);
  });
});
