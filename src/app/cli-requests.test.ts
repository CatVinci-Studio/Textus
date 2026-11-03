import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../prefs/settings-types";
import {
  againstCwd,
  answerCliRequest,
  entryId,
  rows,
  type CliRequest,
  type CliWindow,
} from "./cli-requests";

const request = (
  command: string,
  args: string[],
  json = false,
): CliRequest => ({
  id: "cli-1",
  command,
  args,
  cwd: "/w",
  json,
});

function fakeWindow() {
  const setSettings = vi.fn();
  const window: CliWindow = {
    openPath: async () => {},
    activePath: null,
    settings: { ...DEFAULT_SETTINGS, themeId: "paper" },
    setSettings,
  };
  return { window: () => window, setSettings };
}

describe("textus requests in a window", () => {
  it("prints rows as aligned columns, or JSON with --json", () => {
    const list = [
      { id: "a", name: "Alpha" },
      { id: "long-id", name: "B" },
    ];
    expect(rows({ json: false }, list).out).toBe("a        Alpha\nlong-id  B");
    expect(JSON.parse(rows({ json: true }, list).out)).toEqual(list);
  });

  it("names a palette entry by its command or menu item", () => {
    expect(entryId({ label: "x", run: { command: "jane.count" } })).toBe(
      "jane.count",
    );
    expect(
      entryId({ label: "x", run: { menu: { native: "plugin-command:a.b" } } }),
    ).toBe("a.b");
    expect(entryId({ label: "x", run: { menu: { local: "undo" } } })).toBe(
      "undo",
    );
  });

  it("reads a typed path against the terminal's folder", () => {
    expect(againstCwd("p.zip", "/w")).toBe("/w/p.zip");
    expect(againstCwd("/abs/p.zip", "/w")).toBe("/abs/p.zip");
    expect(againstCwd("p.zip", "C:\\Users\\a")).toBe("C:\\Users\\a\\p.zip");
    expect(againstCwd("D:\\p.zip", "C:\\w")).toBe("D:\\p.zip");
  });

  it("lists the themes with the current one marked, and sets one by name", async () => {
    const { window, setSettings } = fakeWindow();
    const listed = await answerCliRequest(
      request("theme", ["list"], true),
      window,
    );
    expect(JSON.parse(listed.out)).toContainEqual({
      current: "*",
      id: "paper",
      name: "Paper",
    });
    const set = await answerCliRequest(
      request("theme", ["set", "Forest"]),
      window,
    );
    expect(set.exit).toBe(0);
    expect(setSettings).toHaveBeenCalledWith({ themeId: "forest" });
    const missing = await answerCliRequest(
      request("theme", ["set", "x"]),
      window,
    );
    expect(missing.exit).toBe(1);
  });

  it("answers an unknown command or usage with exit code 2", async () => {
    const { window } = fakeWindow();
    expect((await answerCliRequest(request("nope", []), window)).exit).toBe(2);
    expect(
      (await answerCliRequest(request("theme", ["paint"]), window)).exit,
    ).toBe(2);
  });
});
