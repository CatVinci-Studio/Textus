import { describe, expect, it, vi } from "vitest";
import { NO_CHOICES } from "../../theme/theme-typography";
import {
  readWorkshopTheme,
  workshopThemeCss,
} from "../../theme/workshop-theme";

const disk = new Map<string, string>();
const stored = new Map<string, string>();
vi.mock("../../platform/ipc", () => ({
  fs: {
    readTextFile: (path: string) =>
      disk.has(path)
        ? Promise.resolve(disk.get(path))
        : Promise.reject(new Error(`no ${path}`)),
    writeTextFile: (path: string, text: string) => {
      disk.set(path, text);
      return Promise.resolve();
    },
  },
  exportDoc: {
    exportSaveDialog: () => Promise.resolve("/out/Quiet.css"),
    revealInDir: () => Promise.resolve(),
  },
  themes: {
    saveThemeCss: (id: string, variant: string, css: string) => {
      stored.set(`${id}/${variant}`, css);
      return Promise.resolve();
    },
    loadThemeCss: (id: string, variant: string) =>
      Promise.resolve(stored.get(`${id}/${variant}`) ?? null),
  },
}));

const { darkSibling, exportUserTheme, importThemeFile } =
  await import("./theme-files");

describe("darkSibling", () => {
  it("names the dark file beside the light one, as the gallery does", () => {
    expect(darkSibling("/a/Quiet.css")).toBe("/a/Quiet-dark.css");
    expect(darkSibling("/a/Quiet-dark.css")).toBeNull();
  });
});

describe("a theme exported and imported back", () => {
  it("is the same two files, its workshop choices kept", async () => {
    const choices = { ...NO_CHOICES, lineHeight: 2.2, palette: "dusk" };
    const css = workshopThemeCss({
      name: "Quiet",
      base: {
        light: ":root { --doc-bg: #fff; }\n",
        dark: ":root { --doc-bg: #000; }\n",
      },
      choices,
    });
    stored.set("user-a/light", css.light);
    stored.set("user-a/dark", css.dark!);
    await exportUserTheme({ id: "user-a", name: "Quiet", hasDark: true });
    expect([...disk.keys()]).toEqual(["/out/Quiet.css", "/out/Quiet-dark.css"]);

    const meta = await importThemeFile("/out/Quiet.css");
    expect(meta).toMatchObject({ name: "Quiet", hasDark: true });
    const back = {
      light: stored.get(`${meta.id}/light`)!,
      dark: stored.get(`${meta.id}/dark`)!,
    };
    expect(back).toEqual(css);
    expect(readWorkshopTheme(back, "Quiet")?.choices).toEqual(choices);
  });

  it("is one file for a one-file theme", async () => {
    disk.clear();
    stored.set("user-b/light", "#write { color: teal; }");
    await exportUserTheme({ id: "user-b", name: "Teal", hasDark: false });
    expect([...disk.keys()]).toEqual(["/out/Quiet.css"]);
    const meta = await importThemeFile("/out/Quiet.css");
    expect(meta.hasDark).toBe(false);
  });
});
