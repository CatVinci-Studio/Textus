import { describe, expect, it, vi } from "vitest";

const README = `# Sheet Music

Draws sheet music.

## Changes

- **0.1.0** - First version.

<!-- ai-tools -->
## Tools for Textus AI

- \`check_abc\`: Checks a block.
<!-- /ai-tools -->
`;
const ipc = {
  file: vi.fn(() => Promise.resolve(new TextEncoder().encode(README).buffer)),
  catalogReadme: vi.fn(() => Promise.resolve(README)),
};
vi.mock("../../platform/ipc", () => ({ plugins: ipc }));
vi.mock("../../platform/capabilities", async (actual) => ({
  ...(await actual<typeof import("../../platform/capabilities")>()),
  hasTextusAi: false,
}));
const { catalogReadme, installedReadme, readmeHere } = await import("./readme");

describe("a plugin's README where there is no Textus AI (iOS)", () => {
  it("leaves out the section on its tools for Textus AI", () => {
    const shown = readmeHere(README, false);
    expect(shown).not.toMatch(/Tools for Textus AI|check_abc|ai-tools/);
    expect(shown).toContain("- **0.1.0** - First version.");
    expect(readmeHere(README, true)).toBe(README);
  });

  it("does so on its store page and once installed", async () => {
    for (const text of [
      await catalogReadme("catvinci.abc", "en"),
      await installedReadme("catvinci.abc", "en"),
    ]) {
      expect(text).toContain("Draws sheet music.");
      expect(text).not.toContain("Tools for Textus AI");
    }
  });
});
