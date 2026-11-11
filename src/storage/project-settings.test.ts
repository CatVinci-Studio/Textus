import { describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => new Map<string, string>());
vi.mock("../platform/ipc", () => ({
  fs: {
    readTextFile: async (path: string) => {
      const text = disk.get(path);
      if (text === undefined) throw new Error("No such file");
      return text;
    },
    writeTextFile: async (path: string, text: string) => {
      disk.set(path, text);
    },
    fileMtimeMs: async (path: string) => (disk.has(path) ? 1 : null),
  },
}));

import { projectSettingsFile, updateProjectSettings } from "./project-settings";

describe("a project's settings file", () => {
  it("keeps every other key, and is never written over when it doesn't read", async () => {
    const file = projectSettingsFile("/w");
    await updateProjectSettings("/w", "plugins", () => ({ a: 1 }));
    await updateProjectSettings("/w", "conventions", () => ({ b: 2 }));
    expect(JSON.parse(disk.get(file)!)).toEqual({
      plugins: { a: 1 },
      conventions: { b: 2 },
    });
    disk.set(file, '{"conventions": {"b": 2}, oops');
    await expect(
      updateProjectSettings("/w", "plugins", () => ({ a: 3 })),
    ).rejects.toThrow();
    expect(disk.get(file)).toContain("oops");
  });
});
