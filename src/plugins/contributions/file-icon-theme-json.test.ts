import { expect, it } from "vitest";
import {
  iconTheme,
  parseIconThemeJson,
  pathBeside,
} from "./file-icon-theme-json";

const THEME = {
  iconDefinitions: {
    md: { iconPath: "./svg/markdown.svg" },
    mdLight: { iconPath: "svg/markdown_light.svg" },
    file: { iconPath: "../file.svg" },
    folder: { iconPath: "svg/folder.svg" },
    gone: { iconPath: "svg/missing.svg" },
    bad: { iconPath: "../../outside.svg" },
    png: { iconPath: "svg/picture.png" },
  },
  file: "file",
  folder: "folder",
  fileExtensions: { MD: "md", ".txt": "gone", png: "png", js: "nothing" },
  fileNames: { "README.md": "md" },
  folderNames: { Docs: "folder", src: "bad" },
  light: { fileExtensions: { md: "mdLight" } },
};

it("finds an icon beside the theme, never outside the plugin or not an SVG", () => {
  expect(pathBeside("icons/theme.json", "./svg/a.svg")).toBe("icons/svg/a.svg");
  expect(pathBeside("icons/theme.json", "../a.svg")).toBe("a.svg");
  expect(pathBeside("icons/theme.json", "../../a.svg")).toBeNull();
  expect(pathBeside("theme.json", "/etc/a.svg")).toBeNull();
  expect(pathBeside("theme.json", "https://x.test/a.svg")).toBeNull();
  expect(pathBeside("theme.json", "a.png")).toBeNull();
});

it("reads names lowercase, extensions without their dot, light over dark", () => {
  const parsed = parseIconThemeJson(THEME, "icons/theme.json");
  expect([...parsed.icons.keys()].sort()).toEqual(
    ["file", "folder", "gone", "md", "mdLight"].sort(),
  );
  expect(parsed.dark.fileExtensions.get("md")).toBe("md");
  expect(parsed.dark.fileExtensions.get("txt")).toBe("gone");
  expect(parsed.dark.fileNames.get("readme.md")).toBe("md");
  expect(parsed.dark.folderNames.get("docs")).toBe("folder");
  expect(parsed.light.fileExtensions.get("md")).toBe("mdLight");
  // What light doesn't name is dark's.
  expect(parsed.light.fileNames.get("readme.md")).toBe("md");
  expect(parsed.light.file).toBe("file");
});

it("draws only icons it could read, the app's where one is missing", () => {
  const parsed = parseIconThemeJson(THEME, "icons/theme.json");
  const urls = new Map([
    ["icons/svg/markdown.svg", "data:md"],
    ["icons/svg/markdown_light.svg", "data:md-light"],
    ["file.svg", "data:file"],
    ["icons/svg/folder.svg", "data:folder"],
  ]);
  const theme = iconTheme(parsed, urls);
  expect(theme.dark.fileExtensions.get("md")).toBe("data:md");
  expect(theme.light.fileExtensions.get("md")).toBe("data:md-light");
  expect(theme.dark.fileExtensions.has("txt")).toBe(false);
  expect(theme.dark.fileExtensions.has("js")).toBe(false);
  expect(theme.dark.folderNames.has("src")).toBe(false);
  expect(theme.dark.file).toBe("data:file");
  expect(theme.dark.folderExpanded).toBeUndefined();
});

it("shares one table when the theme has no light icons", () => {
  const dark = { ...THEME, light: undefined };
  const theme = iconTheme(parseIconThemeJson(dark, "t.json"), new Map());
  expect(theme.light).toBe(theme.dark);
});

it("refuses JSON that isn't a theme", () => {
  expect(() => parseIconThemeJson([], "t.json")).toThrow(/iconDefinitions/);
  expect(() => parseIconThemeJson({ file: "x" }, "t.json")).toThrow(
    /iconDefinitions/,
  );
});
