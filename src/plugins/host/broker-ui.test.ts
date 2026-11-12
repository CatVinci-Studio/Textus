import { describe, expect, it, vi } from "vitest";
import { uiHandlers } from "./broker-ui";
import type { PluginScope } from "./broker-scope";

function scopeOf(id: string, granted: string[]) {
  const runCommand = vi.fn(() => Promise.resolve(null));
  const scope = {
    id,
    name: () => id,
    need: (permission: string) => {
      if (!granted.includes(permission))
        throw new Error(`${id} was not granted ${permission}.`);
    },
    deps: { runCommand },
  } as unknown as PluginScope;
  return { execute: uiHandlers(scope)["commands.execute"], runCommand };
}

describe("commands.execute", () => {
  it("runs Textus's commands and the plugin's own", async () => {
    const { execute, runCommand } = scopeOf("a.notes", []);
    await execute({ command: "textus.save", args: [] });
    await execute({ command: "a.notes.add", args: [] });
    expect(runCommand).toHaveBeenCalledTimes(2);
  });

  it("runs another plugin's command only with leave to", async () => {
    const without = scopeOf("a.notes", []);
    expect(() => without.execute({ command: "b.sync.push", args: [] })).toThrow(
      /commands:b\.sync/,
    );
    expect(without.runCommand).not.toHaveBeenCalled();
    const granted = scopeOf("a.notes", ["commands:b.sync"]);
    await granted.execute({ command: "b.sync.push", args: [1] });
    expect(granted.runCommand).toHaveBeenCalledWith(
      "b.sync.push",
      [1],
      "a.notes",
    );
  });
});

describe("ui.pick as a command line", () => {
  it("counts its Enter as a key pressed, for the editor ops that follow", async () => {
    const { held } = await import("../contributions/key-holder");
    held.owner = {
      plugin: "catvinci.vim",
      name: "Vim",
      capture: { mode: "some", keys: [] },
      deliver: () => {},
      lastKeyAt: 0,
    };
    const scope = {
      id: "catvinci.vim",
      name: () => "Vim",
      need: () => {},
      deps: { pickWithCommands: () => Promise.resolve("12") },
    } as unknown as PluginScope;
    await uiHandlers(scope)["ui.pick"]({ items: [], commands: true });
    expect(Date.now() - held.owner.lastKeyAt).toBeLessThan(1000);
    held.owner = null;
  });
});
