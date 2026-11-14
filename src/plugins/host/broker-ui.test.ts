import { describe, expect, it, vi } from "vitest";
import { stopPluginUi, uiHandlers } from "./broker-ui";
import { pluginWhenKeys } from "../contributions/plugin-when-keys";
import { evaluateWhen } from "../contributions/when";
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
  const handlers = uiHandlers(scope);
  return {
    execute: handlers["commands.execute"],
    setContext: handlers["commands.setContext"],
    runCommand,
  };
}

describe("commands.setContext", () => {
  it("sets the plugin's own when keys, and they go when it stops", () => {
    const { setContext } = scopeOf("a.notes", []);
    setContext({ key: "a.notes.focus", value: true });
    setContext({ key: "a.notes.mode", value: "review" });
    expect(pluginWhenKeys()).toEqual({
      "a.notes.focus": true,
      "a.notes.mode": "review",
    });
    expect(
      evaluateWhen("a.notes.focus && a.notes.mode == review", pluginWhenKeys()),
    ).toBe(true);
    setContext({ key: "a.notes.focus", value: false });
    expect(pluginWhenKeys()).toEqual({ "a.notes.mode": "review" });
    stopPluginUi("a.notes");
    expect(pluginWhenKeys()).toEqual({});
  });

  it("refuses another's keys and Textus's", () => {
    const { setContext } = scopeOf("a.notes", []);
    expect(() => setContext({ key: "b.sync.on", value: true })).toThrow();
    expect(() => setContext({ key: "isMac", value: true })).toThrow();
    expect(() => setContext({ key: "a.notes.x", value: 3 })).toThrow();
  });
});

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
