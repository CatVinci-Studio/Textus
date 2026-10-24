// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * docs/dev/textus.d.ts names every part of the API the plugin host's
 * runtime (runtime/host.js) gives a plugin, and nothing it doesn't: the
 * runtime is run here with no window behind it, and its `textus` walked.
 */

const ROOT = join(__dirname, "..", "..");
const HOST = readFileSync(join(__dirname, "runtime", "host.js"), "utf8");
const TYPES = readFileSync(join(ROOT, "docs", "dev", "textus.d.ts"), "utf8");

/** Every `namespace.member` of the runtime's textus object. */
function runtimeMembers(): string[] {
  const w = window as unknown as Record<string, unknown>;
  w.createEndpoint = () => ({ call: () => Promise.resolve(), notify() {} });
  new Function("createEndpoint", HOST)(w.createEndpoint);
  const api = w.textus as Record<string, Record<string, unknown>>;
  const out: string[] = [];
  for (const [ns, part] of Object.entries(api))
    for (const name of Object.getOwnPropertyNames(part))
      out.push(`${ns}.${name}`);
  return out;
}

/** The members the declaration file gives an interface. */
function declared(iface: string): string[] {
  const body = new RegExp(`interface ${iface} \\{([\\s\\S]*?)\\n    \\}`).exec(
    TYPES,
  )?.[1];
  if (!body) return [];
  return [...body.matchAll(/^ {6}(?:readonly )?(\w+)[(?:<]/gm)].map(
    (m) => m[1],
  );
}

const INTERFACES: Record<string, string> = {
  plugin: "PluginInfo",
  env: "Env",
  l10n: "L10n",
  commands: "Commands",
  window: "Window",
  editor: "Editor",
  document: "Document",
  workspace: "Workspace",
  net: "Net",
  storage: "Storage",
  settings: "Settings",
  clipboard: "Clipboard",
};

describe("textus.d.ts", () => {
  it("declares every part of the plugin API, and only those", () => {
    const actual = runtimeMembers().sort();
    const types = Object.entries(INTERFACES)
      .flatMap(([ns, iface]) => declared(iface).map((m) => `${ns}.${m}`))
      .sort();
    expect(types).toEqual(actual);
  });
});
