import { describe, expect, it } from "vitest";
import { parseManifest } from "./store/manifest";
import { offeredHere, onlyForAi } from "./plugin-platform";

const tool = { name: "search", description: "Searches the web." };
const manifest = (id: string, contributes: object) =>
  parseManifest({
    id,
    name: id,
    version: "1.0.0",
    publisher: "catvinci",
    engines: { textus: ">=1.3.0" },
    platforms: ["desktop", "ios"],
    main: "host.js",
    contributes,
  });
const command = (id: string) => ({ command: `${id}.go`, title: "Go" });

// The official plugins as they were when the rule was written: only
// Keenable and Openverse give nothing but tools for Textus AI.
const keenable = manifest("catvinci.keenable", {
  aiTools: [tool],
  commands: [command("catvinci.keenable")],
});
const openverse = manifest("catvinci.openverse", { aiTools: [tool] });
const headingNumbers = manifest("catvinci.heading-numbers", {
  aiTools: [tool],
  settings: [{ key: "on", type: "boolean", default: true, title: "On" }],
});
const abc = manifest("catvinci.abc", {
  aiTools: [tool],
  codeBlocks: [{ language: "abc" }],
});
const wakatime = manifest("catvinci.wakatime", {
  commands: [command("catvinci.wakatime")],
});
const templates = manifest("catvinci.templates", {
  aiTools: [tool],
  commands: [command("catvinci.templates")],
  menus: { "app/plugins": [{ command: "catvinci.templates.go" }] },
});

describe("plugins only for Textus AI", () => {
  it("are the ones whose every contribution goes with its tools", () => {
    expect(onlyForAi(keenable)).toBe(true);
    expect(onlyForAi(openverse)).toBe(true);
    for (const m of [headingNumbers, abc, wakatime, templates])
      expect(onlyForAi(m), m.id).toBe(false);
  });

  it("aren't offered where there is no Textus AI, and are where there is", () => {
    expect(offeredHere(keenable, false)).toBe(false);
    expect(offeredHere(openverse, false)).toBe(false);
    for (const m of [headingNumbers, abc, wakatime, templates])
      expect(offeredHere(m, false), m.id).toBe(true);
    expect(offeredHere(keenable, true)).toBe(true);
  });
});
