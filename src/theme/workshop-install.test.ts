import { describe, expect, it, vi } from "vitest";
import { NO_CHOICES } from "./theme-typography";

const saved = new Map<string, string>();
vi.mock("../platform/ipc", () => ({
  fs: {},
  themes: {
    saveThemeCss: (id: string, variant: string, css: string) => {
      saved.set(`${id}/${variant}`, css);
      return Promise.resolve();
    },
    loadThemeCss: (id: string, variant: string) =>
      Promise.resolve(saved.get(`${id}/${variant}`) ?? null),
  },
}));

const { installWorkshopTheme, startingTheme } =
  await import("./workshop-install");

const OLD = { id: "user-old", name: "Old", hasDark: false };
const BASE = {
  light: ":root { --doc-bg: #fff; }\n",
  dark: ":root { --doc-bg: #000; }\n",
};

describe("installWorkshopTheme", () => {
  it("saves both forms, lists the theme after the others and puts it in use", async () => {
    const { settings } = await installWorkshopTheme(
      { name: "Large", base: BASE, choices: { ...NO_CHOICES, fontSize: 18 } },
      undefined,
      undefined,
      [OLD],
    );
    const made = settings.userThemes[1];
    expect(settings.userThemes[0]).toBe(OLD);
    expect(made).toMatchObject({
      name: "Large",
      hasDark: true,
      workshop: true,
    });
    expect(settings.themeId).toBe(made.id);
    expect(saved.get(`${made.id}/light`)).toMatch(
      /#fff[\s\S]*--doc-font-size: 18px/,
    );
    expect(saved.get(`${made.id}/dark`)).toMatch(
      /#000[\s\S]*--doc-font-size: 18px/,
    );
  });

  it("builds on an installed theme as stored, one file staying one", async () => {
    saved.set("user-old/light", "#write { color: teal; }");
    const start = await startingTheme("user-old", [OLD], "Old");
    expect(start).toEqual({
      name: "Old",
      base: { light: "#write { color: teal; }", dark: null },
      choices: NO_CHOICES,
    });
    const { settings } = await installWorkshopTheme(
      { ...start!, name: "Teal", choices: { ...NO_CHOICES, indent: 2 } },
      undefined,
      undefined,
      [OLD],
    );
    const made = settings.userThemes[1];
    expect(made.hasDark).toBe(false);
    expect(saved.get(`${made.id}/light`)).toMatch(
      /color: teal[\s\S]*text-indent: 2em/,
    );
    expect(saved.has(`${made.id}/dark`)).toBe(false);
  });

  it("reopens a workshop theme as left and saves over it in place", async () => {
    const first = await installWorkshopTheme(
      { name: "Mine", base: BASE, choices: { ...NO_CHOICES, lineHeight: 2 } },
      undefined,
      undefined,
      [],
    );
    const id = first.settings.themeId;
    const reopened = await startingTheme(id, first.settings.userThemes, "Mine");
    expect(reopened?.base).toEqual(BASE);
    expect(reopened?.choices.lineHeight).toBe(2);
    const again = await installWorkshopTheme(
      { ...reopened!, choices: { ...reopened!.choices, indent: 1 } },
      undefined,
      undefined,
      first.settings.userThemes,
      id,
    );
    expect(again.settings.themeId).toBe(id);
    expect(again.settings.userThemes).toHaveLength(1);
    const light = saved.get(`${id}/light`)!;
    expect(light).toContain("text-indent: 1em");
    // Not stacked on the earlier save: one mark, one starting theme.
    expect(light.match(/workshop: /g)).toHaveLength(1);
    expect(light.match(/--doc-bg: #fff/g)).toHaveLength(1);
  });

  it("has nothing to build on for a theme no longer installed", async () => {
    expect(await startingTheme("user-gone", [OLD], "Gone")).toBeNull();
  });
});
