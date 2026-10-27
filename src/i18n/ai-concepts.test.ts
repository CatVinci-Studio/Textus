import { describe, expect, it } from "vitest";
import { AI_NAME, LANGS, resolveStrings } from "./strings";

// The copy for the AI concepts: the starter files and the names the user
// meets in Settings and the project bar.

/** What the backend sends the model from an agent.md: everything outside
 *  `<!-- -->` comments. */
function sentToModel(text: string): string {
  return text.replace(/<!--[\s\S]*?(-->|$)/g, "").trim();
}

describe.each(LANGS)("AI concept copy in %s", (lang) => {
  const t = resolveStrings(lang);

  it("the agent.md starters teach in comments and send nothing", () => {
    expect(sentToModel(t.agentInstructionsTemplate)).toBe("");
    expect(sentToModel(t.projectInstructionsTemplate)).toBe("");
    // A library entry's how-to is a comment too, so an untouched entry
    // carries no facts.
    const entry = t.projectLibraryTemplate.replace(/\{name\}/g, "Lin Wan");
    expect(sentToModel(entry.replace(/^---[\s\S]*?\n---/, ""))).toBe("");
  });

  it("the starter files name the menu items exactly as the menus do", () => {
    expect(t.projectStyleTemplate).toContain(t.projectLearnStyle);
    expect(t.agentInstructionsTemplate).toContain(t.projectEditInstructions);
    for (const template of [
      t.agentInstructionsTemplate,
      t.projectInstructionsTemplate,
      t.projectStyleTemplate,
      t.projectLibraryTemplate,
    ])
      expect(template).toContain(AI_NAME);
  });

  it("every Settings path names a page that exists", () => {
    // The AI page is AI_NAME ("Textus AI"), not "Settings → AI".
    const settings = t.settingsTitle;
    const pages = [
      t.navGeneral,
      t.navEditor,
      t.navTheme,
      t.navMarkdown,
      t.navAi,
      t.navPrivacy,
      t.navShortcuts,
    ];
    let paths = 0;
    for (const [key, value] of Object.entries(t)) {
      if (typeof value !== "string") continue;
      for (const m of value.matchAll(new RegExp(`${settings} [>→] `, "g"))) {
        paths++;
        const rest = value.slice((m.index ?? 0) + m[0].length);
        expect(
          pages.some((page) => rest.startsWith(page)),
          `${key}: ${value}`,
        ).toBe(true);
      }
    }
    expect(paths).toBeGreaterThan(0);
  });

  it("Settings and the project bar give the same choice the same words", () => {
    // Both "go back to the default" buttons are one string.
    expect(Object.keys(t)).not.toContain("agentWorkspaceRootReset");
    // The Settings row is named after the project folder the menu picks.
    expect(t.projectPickFolder.toLowerCase()).toContain(
      t.agentWorkspaceRootLabel.toLowerCase(),
    );
  });
});
