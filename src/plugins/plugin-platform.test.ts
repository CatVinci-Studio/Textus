import { describe, expect, it } from "vitest";
import { parseManifest } from "./store/manifest";
import { desktopOnly, offeredHere } from "./plugin-platform";

const tool = { name: "search", description: "Searches the web." };
const manifest = (id: string, extra: object) =>
  parseManifest({
    id,
    name: id,
    version: "1.0.0",
    publisher: "catvinci",
    engines: { textus: ">=1.3.0" },
    platforms: ["desktop", "ios"],
    main: "host.js",
    ...extra,
  });

// Keenable gives only tools and says it needs Textus AI; Heading Numbers
// gives tools too but does without; a plugin may say so though it gives
// more than tools, and the store goes by what it says.
const keenable = manifest("catvinci.keenable", {
  needsTextusAi: true,
  contributes: { aiTools: [tool] },
});
const headingNumbers = manifest("catvinci.heading-numbers", {
  contributes: {
    aiTools: [tool],
    settings: [{ key: "on", type: "boolean", default: true, title: "On" }],
  },
});
const aiPanel = manifest("a.ai-panel", {
  needsTextusAi: true,
  contributes: {
    sidebarTabs: [{ id: "a.ai-panel.t", title: "T", type: "list" }],
  },
});
const toolsOnly = manifest("a.tools", { contributes: { aiTools: [tool] } });

describe("plugins that need Textus AI", () => {
  it("aren't offered where there is none, and are where there is", () => {
    expect(offeredHere(keenable, false)).toBe(false);
    expect(offeredHere(aiPanel, false)).toBe(false);
    expect(offeredHere(keenable, true)).toBe(true);
    expect(offeredHere(aiPanel, true)).toBe(true);
  });

  it("are the ones that say so, whatever they contribute", () => {
    expect(offeredHere(headingNumbers, false)).toBe(true);
    expect(offeredHere(toolsOnly, false)).toBe(true);
  });
});

describe("the store's computer-only mark", () => {
  it("goes on a plugin whose platforms leave out ios", () => {
    expect(desktopOnly(manifest("a.b", { platforms: ["desktop"] }))).toBe(true);
    expect(desktopOnly(keenable)).toBe(false);
    // Background work without platforms is the desktop's.
    expect(
      desktopOnly(
        manifest("a.c", { platforms: undefined, background: "jobs.js" }),
      ),
    ).toBe(true);
  });
});
