import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PERMISSION_CALLS,
  PERMISSION_METHODS,
  PERMISSION_TABLE,
} from "./api-permissions";
import { HOST_RUNTIME } from "./host/host-runtime";

const HOST = new URL("./host/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, HOST), "utf8");

describe("the plugin API's permissions", () => {
  it("name only methods the broker has, and calls host.js offers", () => {
    const broker = readdirSync(HOST)
      .filter((f) => /^broker.*\.ts$/.test(f) && !f.includes(".test."))
      .map(read)
      .join("\n");
    for (const method of PERMISSION_METHODS)
      expect(broker, method).toContain(`"${method}":`);
    const host = HOST_RUNTIME;
    for (const method of PERMISSION_METHODS)
      expect(host, method).toContain(`"${method}"`);
  });

  it("are what the install check looks for", () => {
    const needs = (code: string) =>
      PERMISSION_CALLS.filter(([call]) => call.test(code)).map(([, p]) => p);
    expect(needs("await textus.editor.getText()")).toEqual(["editor.read"]);
    expect(needs("textus.files.readText(p)")).toEqual(["files.read"]);
    expect(needs("textus.files.writeText(p, t)")).toEqual([
      "files.read",
      "files.write",
    ]);
    expect(needs("ctx.storage.project.set(k, v)")).toEqual(["project.data"]);
    expect(needs("textus.metadata.tags()")).toEqual(["files.read"]);
    expect(needs("textus.ui.message('hi')")).toEqual([]);
    // What a plugin writes, not the broker's names for it.
    expect(needs("textus.files.frontmatter.update(p, f)")).toEqual([
      "files.read",
      "files.write",
    ]);
    expect(needs("textus.editor.keys.capture(c)")).toEqual(["editor.input"]);
    expect(needs("textus.export.onWillExport(f)")).toEqual(["editor.read"]);
    expect(needs("block.setSource(t)")).toEqual(["editor.write"]);
  });

  it("are written out for tools outside the app", () => {
    // UPDATE=1 writes it again.
    const file = new URL(
      "../../docs/dev/plugin-permissions.json",
      import.meta.url,
    );
    const json = `${JSON.stringify(PERMISSION_TABLE, null, 2)}\n`;
    if (process.env.UPDATE) writeFileSync(file, json);
    expect(readFileSync(file, "utf8")).toBe(json);
  });
});
