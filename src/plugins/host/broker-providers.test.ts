// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { providerHandlers, stopPluginProviders } from "./broker-providers";
import { farFiles, isFarUrl } from "../../platform/far-files";
import type { PluginScope } from "./broker-scope";

const scope = (id: string, answer: (op: string, args: unknown[]) => unknown) =>
  ({
    id,
    request: async (_method: string, params: unknown) => {
      const { op, args } = params as { op: string; args: unknown[] };
      return answer(op, args);
    },
  }) as unknown as PluginScope;

describe("file providers", () => {
  it("serve their own scheme only, list safe names, open only their folders, and go with their plugin", async () => {
    const ssh = providerHandlers(
      scope("a.ssh", (op) =>
        op === "list"
          ? [
              { name: "notes.md", folder: false },
              { name: "drafts", folder: true },
              { name: "../etc", folder: true },
            ]
          : null,
      ),
    );
    const other = providerHandlers(scope("b.other", () => null));
    expect(() => ssh["files.registerProvider"]({ scheme: "https" })).toThrow(
      /can't be/,
    );
    ssh["files.registerProvider"]({ scheme: "SSH" });
    expect(() => other["files.registerProvider"]({ scheme: "ssh" })).toThrow(
      /a\.ssh/,
    );
    expect(isFarUrl("ssh://box/home")).toBe(true);
    const listed =
      await farFiles("ssh://box/home").listFolder("ssh://box/home");
    expect(listed.map((e) => [e.path, e.is_dir])).toEqual([
      ["ssh://box/home/notes.md", false],
      ["ssh://box/home/drafts", true],
    ]);
    expect(() => other["files.openFolder"]({ url: "ssh://box/home" })).toThrow(
      /isn't a folder/,
    );
    const opened: string[] = [];
    window.addEventListener("textus:open-folder", (e) =>
      opened.push((e as CustomEvent<string>).detail),
    );
    ssh["files.openFolder"]({ url: "ssh://box/home" });
    expect(opened).toEqual(["ssh://box/home"]);
    stopPluginProviders("a.ssh");
    expect(isFarUrl("ssh://box/home")).toBe(false);
  });
});
