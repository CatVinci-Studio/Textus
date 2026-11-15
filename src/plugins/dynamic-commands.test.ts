import { describe, expect, it, vi } from "vitest";
import { commands } from "../registry/commands";
import { commandRegistered, commandUnregistered } from "./dynamic-commands";

vi.mock("./store/plugin-records", () => ({
  pluginRecord: () => ({
    manifest: { contributes: { commands: [{ command: "acme.clip.open" }] } },
  }),
}));
vi.mock("./contributions/plugin-contributions", () => ({
  addContribution: () => {},
}));
vi.mock("./app-bridge", () => ({ getActiveDocument: () => null }));

const find = (id: string) => commands().find((c) => c.id === id);

describe("commands a plugin registers at run time", () => {
  it("stays out of the palette, runs, and goes when unregistered", () => {
    const run = vi.fn();
    commandRegistered("acme.clip", "acme.clip.paste-row", false, run);
    const command = find("acme.clip.paste-row");
    expect(command?.palette).toBe(false);
    command?.run(3);
    expect(run).toHaveBeenCalledWith([3]);
    commandUnregistered("acme.clip", "acme.clip.paste-row");
    expect(find("acme.clip.paste-row")).toBeUndefined();
  });

  it("leaves a declared command to the manifest", () => {
    commandRegistered("acme.clip", "acme.clip.open", false, vi.fn());
    expect(find("acme.clip.open")).toBeUndefined();
  });

  it("an editor command waits for a document", () => {
    commandRegistered("acme.clip", "acme.clip.insert", true, vi.fn());
    expect(find("acme.clip.insert")?.enabled?.()).toBe(false);
    commandUnregistered("acme.clip", "acme.clip.insert");
  });
});
