// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

// The boot script Rust injects before the app: what it puts on the first
// frame for an imported theme.

const BOOT_JS = readFileSync("src-tauri/src/boot.js", "utf8");
const THEME_CSS = "#write { color: rgb(1, 2, 3); }";
const CHROME = ":root { --ui-subtle: rgb(10, 20, 30) !important; }";

function boot(
  settings: Record<string, unknown>,
  themeCss: { light: string; dark: string | null },
  uiState: Record<string, unknown> = {},
) {
  new Function(BOOT_JS)();
  (
    window as unknown as { __textusBoot: (b: unknown, c: unknown) => void }
  ).__textusBoot({ rev: 1, label: "main", uiState, settings }, themeCss);
}

const text = (id: string) => document.getElementById(id)?.textContent ?? null;
const mine = (theme: string, hasDark: boolean) => ({
  theme,
  themeId: "mine",
  userThemes: [{ id: "mine", name: "Mine", hasDark }],
  customCss: "#write {}",
});
const remembered = (overrides: object = {}) => ({
  themeChrome: {
    id: "mine",
    dark: false,
    sourceLength: THEME_CSS.length,
    css: CHROME,
    ...overrides,
  },
});

beforeEach(() => {
  document.head.replaceChildren();
  document.documentElement.removeAttribute("data-theme");
});

describe("the boot script and an imported theme", () => {
  it("puts the variant for the appearance on the first frame, Typora's header rewritten, before the user's CSS", () => {
    boot(mine("dark", true), {
      light: THEME_CSS,
      dark: "#write thead th { color: rgb(4, 5, 6); }",
    });
    expect(text("textus-custom-theme")).toBe(
      "#write tr[data-is-header] th { color: rgb(4, 5, 6); }",
    );
    expect(document.documentElement.getAttribute("data-user-theme")).toBe("");
    expect(document.head.lastElementChild?.id).toBe("textus-user-css");
  });

  it("puts the chrome colours it remembers for this theme on the first frame", () => {
    boot(mine("light", false), { light: THEME_CSS, dark: null }, remembered());
    expect(text("textus-imported-chrome")).toBe(CHROME);
  });

  it.each([
    ["another appearance", "dark", remembered()],
    ["a theme file that changed", "light", remembered({ sourceLength: 3 })],
    ["another theme", "light", remembered({ id: "other" })],
  ])(
    "keeps chrome colours remembered for %s off the first frame",
    (_name, theme, uiState) => {
      boot(mine(theme, false), { light: THEME_CSS, dark: null }, uiState);
      expect(text("textus-imported-chrome")).toBeNull();
    },
  );
});
