import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMISSION_CALLS, PERMISSION_METHODS } from "./api-permissions";

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
    const host = read("runtime/host.js");
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
  });
});
