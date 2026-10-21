import { describe, expect, it, vi } from "vitest";
import {
  commandForCombo,
  commands,
  registerCommand,
  runCommand,
} from "./commands";
import { registerSidebarTab, sidebarTab, sidebarTabs } from "./sidebar-tabs";
import { resolveStrings } from "../i18n/strings";

describe("commands", () => {
  it("run by id or by their shortcut, while they can, and go when taken back", () => {
    const run = vi.fn();
    let enabled = true;
    const remove = registerCommand({
      id: "example.hello",
      title: () => "Hello",
      run,
      shortcut: "mod+alt+9",
      enabled: () => enabled,
    });
    expect(runCommand("example.hello")).toBe(true);
    expect(commandForCombo("mod+alt+9")?.id).toBe("example.hello");
    enabled = false;
    expect(runCommand("example.hello")).toBe(false);
    expect(commandForCombo("mod+alt+9")).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
    expect(() =>
      registerCommand({ id: "example.hello", title: () => "", run }),
    ).toThrow(/already registered/);
    remove();
    expect(commands()).toHaveLength(0);
    expect(runCommand("example.hello")).toBe(false);
  });
});

describe("sidebar tabs", () => {
  it("are Files, Outline and Clipboard, then any added", () => {
    const t = resolveStrings("en");
    expect(sidebarTabs().map((tab) => tab.id)).toEqual([
      "tree",
      "outline",
      "clipboard",
    ]);
    const remove = registerSidebarTab({
      id: "example",
      label: () => "Example",
      Icon: () => null,
      Panel: () => null,
    });
    expect(sidebarTabs().at(-1)?.label(t)).toBe("Example");
    remove();
    // One no longer there is Files.
    expect(sidebarTab("example").id).toBe("tree");
  });
});
