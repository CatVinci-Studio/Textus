import { expect, it, vi } from "vitest";

const { set, updated } = vi.hoisted(() => ({
  set: vi.fn(async (...args: unknown[]) => void args),
  updated: [] as unknown[],
}));
vi.mock("../platform/ipc", () => ({ plugins: { set } }));
vi.mock("./store/ask-permissions", () => ({
  askPermissions: async () => null,
}));
vi.mock("./manager", () => ({
  apply: () => {},
  loadPlugins: async () => {},
  withdraw: () => {},
}));
vi.mock("./running-hosts", () => ({ hosts: new Map(), stopHost: () => {} }));
vi.mock("./store/plugin-records", () => ({
  pluginRecord: () => ({
    id: "p",
    status: "on",
    granted: ["files.read"],
    manifest: { permissions: ["files.read", "network"] },
  }),
  pluginsSnapshot: () => ({ allOn: true }),
  publish: () => {},
  update: (_id: string, patch: unknown) => updated.push(patch),
}));

import { setPluginEnabled } from "./plugin-switches";

it("turns off a plugin on whose update's new permission is refused", async () => {
  await setPluginEnabled("p", true);
  expect(set).toHaveBeenCalledWith("p", false, ["files.read"]);
  expect(updated).toEqual([expect.objectContaining({ status: "off" })]);
});
