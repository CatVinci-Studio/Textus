import { describe, expect, it } from "vitest";
import { checkPlugin } from "./plugin-check";
import { parseManifest } from "./manifest";

function plugin(manifest: Record<string, unknown>, host: string) {
  const parsed = parseManifest({
    id: "local.demo",
    name: "Demo",
    version: "0.1.0",
    publisher: "local",
    description: "A demo.",
    engines: { textus: ">=1.3.0" },
    main: "host.js",
    permissions: [],
    ...manifest,
  });
  return checkPlugin(parsed, [
    { path: "textus-plugin.json", text: "{}" },
    { path: "host.js", text: host },
  ]);
}

describe("checkPlugin", () => {
  it("passes a plugin that registers what it declares and asks for what it uses", () => {
    expect(
      plugin(
        {
          permissions: ["editor.read"],
          contributes: {
            commands: [{ command: "local.demo.count", title: "Count" }],
          },
        },
        `exports.activate = (ctx) => {
          // document.body is the frame's, so this plugin never touches it.
          ctx.subscriptions.push(textus.commands.register("local.demo.count", async () => {
            const text = await textus.editor.getText();
            window.setTimeout(() => textus.ui.message(String(text.length)), 0);
            await ctx.storage.global.set("last", text.length);
          }));
        };`,
      ),
    ).toEqual([]);
  });

  it("flags DOM code in host.js, which draws only in its hidden frame", () => {
    expect(
      plugin({}, `const b = document.createElement("button");`),
    ).toContainEqual({ kind: "dom" });
    expect(plugin({}, `window.addEventListener("x", f);`)).toContainEqual({
      kind: "dom",
    });
  });

  it("flags a call whose permission the manifest leaves out", () => {
    expect(
      plugin(
        { permissions: ["files.write"] },
        `textus.editor.insertText("x"); textus.files.writeText("a.md", "");`,
      ),
    ).toEqual([
      { kind: "permission", permission: "editor.write" },
      { kind: "permission", permission: "files.read" },
    ]);
  });

  it("flags a declared command or tab the code never registers", () => {
    expect(
      plugin(
        {
          contributes: {
            commands: [
              { command: "local.demo.add", title: "Add" },
              { command: "local.demo.joined", title: "Joined" },
            ],
            sidebarTabs: [
              { id: "local.demo.panel", title: "Panel", type: "webview" },
            ],
          },
        },
        `textus.commands.register("local.demo.add", f);
         textus.commands.register(ctx.plugin.id + ".joined", g);`,
      ),
    ).toEqual([{ kind: "unregistered", id: "local.demo.panel" }]);
  });

  it("reads nothing for a plugin with no code", () => {
    expect(plugin({ main: undefined }, `document.body`)).toEqual([]);
  });
});
