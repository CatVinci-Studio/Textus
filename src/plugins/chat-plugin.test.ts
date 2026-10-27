import { describe, expect, it } from "vitest";
import { pluginsInReply } from "./chat-plugin";

const manifest = {
  id: "local.word-count",
  name: "Word Count",
  version: "1.0.0",
  publisher: "local",
  description: "Counts the words of the selection.",
  engines: { textus: "^1.3.0" },
  main: "host.js",
  permissions: ["editor.read"],
  contributes: {
    commands: [{ command: "local.word-count.count", title: "Count Words" }],
  },
};

const reply = [
  "A command that counts the selection's words.",
  "",
  "```json textus-plugin.json",
  JSON.stringify(manifest, null, 2),
  "```",
  "",
  "```js host.js",
  "exports.activate = function () {};",
  "```",
  "",
  "```markdown README.md",
  "# Word Count",
  "",
  "```",
  "",
  "```js",
  "// an example, not a file",
  "```",
].join("\n");

describe("a plugin in a reply", () => {
  it("is its manifest and the named files after it", () => {
    const [plugin] = pluginsInReply(reply);
    expect(plugin.error).toBeNull();
    expect(plugin.manifest?.id).toBe("local.word-count");
    expect(plugin.files.map((f) => f.path)).toEqual([
      "textus-plugin.json",
      "host.js",
      "README.md",
    ]);
    expect(plugin.files[1].text).toBe("exports.activate = function () {};\n");
  });

  it("says why a manifest can't be installed", () => {
    const bad = reply.replace('"version": "1.0.0",', "");
    const [plugin] = pluginsInReply(bad);
    expect(plugin.manifest).toBeNull();
    expect(plugin.error).toMatch(/version/);
  });

  it("is nothing in a reply without a manifest", () => {
    expect(pluginsInReply("```js host.js\nx\n```")).toEqual([]);
  });
});
