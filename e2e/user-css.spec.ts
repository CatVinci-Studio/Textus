import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openApp, pasteMarkdown } from "./helpers";

// Imported Typora themes and Custom CSS: a theme applies whole in either
// appearance, the user's CSS wins over both, and the cascade layer holds.
// The fixture themes imitate the shapes real themes take.

const THEMES = {
  newsprint: {
    file: "newsprint-like.css",
    family: "PT Serif",
    bold: "700",
  },
  pixyll: {
    file: "pixyll-like.css",
    family: "Merriweather",
    bold: "700",
  },
  latex: {
    file: "latex-like.css",
    family: "Latin Modern Roman",
    bold: "900",
  },
} as const;

const fixture = (file: string) =>
  readFileSync(new URL(`./fixtures/themes/${file}`, import.meta.url), "utf8");

const DOC = `# Heading One

Intro paragraph with **bold**, *italic*, \`inline code\` and a [link](https://example.com), long enough to wrap onto a second line in the column.

## Second level

### Third level

> A quoted line.

#### Fourth level

\`\`\`js
const x = 1;
\`\`\`

| Name | Qty |
|---|---|
| Apple | 10 |
| Banana | 200 |
| Cherry | 3 |
`;

/** Answers the theme commands from memory: the "file" Import CSS… picks,
 *  the theme store, the export dialog and the file it writes. `latency`
 *  slows every one of them, as the native file picker is. */
async function installThemeBackend(
  page: Page,
  files: Record<string, string>,
  latency = 0,
) {
  await page.evaluate(
    ({ files, latency }) => {
      const w = window as unknown as Record<string, unknown> & {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
        };
      };
      const saved: Record<string, string> = {};
      const written: Record<string, string> = {};
      w.__themeStore = { saved, written };
      w.__themeLatency = latency;
      const original = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = async (cmd, args = {}) => {
        const delay = Number(w.__themeLatency) || 0;
        if (delay) await new Promise((r) => setTimeout(r, delay));
        switch (cmd) {
          case "open_css_file_dialog":
            return (w.__nextPick as string | undefined) ?? null;
          case "read_text_file":
            if (String(args.path) in files) return files[String(args.path)];
            if (String(args.path) in written) return written[String(args.path)];
            break;
          case "save_theme_css":
            saved[`${args.id}:${args.variant}`] = String(args.css);
            return null;
          case "load_theme_css":
            return saved[`${args.id}:${args.variant}`] ?? null;
          case "delete_theme":
            return null;
          case "export_save_dialog":
            return "/exports/textus-theme.css";
          case "write_text_file":
            written[String(args.path)] = String(args.contents);
            return null;
        }
        return original(cmd, args);
      };
    },
    { files, latency },
  );
}

async function openSettings(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await dialog
    .locator(".settings-nav-item", { hasText: "Editor & Appearance" })
    .click();
  return dialog;
}

async function importTheme(page: Page, path: string) {
  await page.evaluate((p) => {
    (window as unknown as { __nextPick: string }).__nextPick = p;
  }, path);
  const dialog = await openSettings(page);
  await dialog.getByRole("button", { name: "Get more themes" }).click();
  // Behind the Themes tab's "⋯".
  await dialog.getByRole("button", { name: "More", exact: true }).click();
  await dialog.getByRole("menuitem", { name: "Import CSS…" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-user-theme", "");
  await expect(page.locator("#textus-imported-chrome")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

async function setAppearance(page: Page, mode: "Light" | "Dark") {
  const dialog = await openSettings(page);
  await dialog.getByRole("radio", { name: mode }).check();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    mode.toLowerCase(),
  );
  // The theme reloads and its chrome is derived again for the appearance.
  await page.waitForTimeout(300);
}

/** Contrast of each selector's text against what is painted behind it:
 *  the backgrounds of it and its ancestors, composited until one is
 *  opaque. Colours go through a canvas, which reads any CSS colour. */
async function contrasts(page: Page, selectors: string[]) {
  return page.evaluate((selectors) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (value: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = Array.from(ctx.getImageData(0, 0, 1, 1).data);
      return [r, g, b, a / 255];
    };
    const lum = ([r, g, b]: number[]) =>
      [r, g, b]
        .map((v) => v / 255)
        .map((s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const out: Record<string, number> = {};
    for (const selector of selectors) {
      const el = document.querySelector<HTMLElement>(
        `[data-active-tab="true"] ${selector}`,
      );
      if (!el) {
        out[selector] = -1;
        continue;
      }
      const layers: number[][] = [];
      for (let node: Element | null = el; node; node = node.parentElement) {
        const bg = rgba(getComputedStyle(node).backgroundColor);
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] >= 1) break;
      }
      let base = [255, 255, 255];
      for (const [r, g, b, a] of layers.reverse())
        base = [r, g, b].map((v, i) => v * a + base[i] * (1 - a));
      const [r, g, b, a] = rgba(getComputedStyle(el).color);
      const text = [r, g, b].map((v, i) => v * a + base[i] * (1 - a));
      const [hi, lo] = [lum(text), lum(base)].sort((x, y) => y - x);
      out[selector] = Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    }
    return out;
  }, selectors);
}

/** The computed `prop` of the first match of each selector in the
 *  active editor (`::before` after a selector reads that pseudo). */
async function computed(page: Page, selector: string, prop: string) {
  return page.evaluate(
    ([selector, prop]) => {
      const [base, pseudo] = selector.split("::");
      const el = document.querySelector(`[data-active-tab="true"] ${base}`);
      if (!el) return null;
      return getComputedStyle(el, pseudo ? `::${pseudo}` : null)
        .getPropertyValue(prop)
        .trim();
    },
    [selector, prop],
  );
}

const READABLE = [
  "#write > p",
  "#write th",
  "#write td",
  "#write p code",
  "#write pre",
];

for (const [name, theme] of Object.entries(THEMES)) {
  test(`an imported ${name}-like theme applies fully in light and in dark`, async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    await pasteMarkdown(page, DOC);
    const path = `/themes/${theme.file}`;
    await installThemeBackend(page, { [path]: fixture(theme.file) });
    await importTheme(page, path);

    for (const mode of ["Light", "Dark"] as const) {
      await setAppearance(page, mode);
      await expect(page.locator("html")).toHaveAttribute("data-user-theme", "");
      // Textus's ornaments are off under an imported theme.
      expect(await computed(page, "#write h4::before", "content")).toBe("none");
      expect(await computed(page, "#write h3", "border-left-style")).toBe(
        "none",
      );
      // The theme's face and bold reach the document.
      expect(
        await computed(page, "#write > p", "font-family"),
        `${name} ${mode}`,
      ).toContain(theme.family);
      expect(await computed(page, "#write strong", "font-weight")).toBe(
        theme.bold,
      );
      // And it is readable: a one-design theme keeps its own page in dark
      // instead of its pinned dark text landing on a dark page.
      const ratios = await contrasts(page, READABLE);
      for (const [selector, ratio] of Object.entries(ratios))
        expect(ratio, `${name} ${mode} ${selector}`).toBeGreaterThanOrEqual(
          4.5,
        );
    }
    // Dark-only document colours stand down on that light page.
    await expect(page.locator("html")).toHaveAttribute("data-light-page", "");
    await setAppearance(page, "Light");
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-light-page",
      "",
    );
  });
}

test("an imported theme's own interface variables win over the derived ones", async ({
  page,
}) => {
  // A theme author sets the sidebar, a fill's label, Find's highlight and a
  // card's shadow; the window takes them in light and in dark instead of
  // the colours Textus derives from the page.
  const OWN = {
    "--ui-subtle": "rgb(10, 20, 30)",
    "--ui-on-fill": "rgb(1, 1, 1)",
    "--ui-find-match": "rgb(4, 5, 6)",
    "--shadow-card": "none",
  };
  const css = `${fixture("latex-like.css")}
:root { ${Object.entries(OWN)
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ")} }`;
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, DOC);
  const path = "/themes/own-variables.css";
  await installThemeBackend(page, { [path]: css });
  await importTheme(page, path);
  for (const mode of ["Light", "Dark"] as const) {
    await setAppearance(page, mode);
    const got = await page.evaluate((keys) => {
      const root = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        keys.map((k) => [k, root.getPropertyValue(k).trim()]),
      );
    }, Object.keys(OWN));
    expect(got, mode).toEqual(OWN);
  }
});

const CUSTOM_CSS = `body { font-family: "Custom Probe Face", serif; }
strong { font-weight: 800; }
em { font-style: normal; }
:root { --doc-bg: rgb(1, 2, 3); }
#write > p { text-indent: 2em; }
h2 { border-bottom: none; }`;

async function expectCustomCssWins(page: Page, label: string) {
  expect(await computed(page, "#write > p", "font-family"), label).toContain(
    "Custom Probe Face",
  );
  expect(await computed(page, "#write strong", "font-weight"), label).toBe(
    "800",
  );
  expect(await computed(page, "#write em", "font-style"), label).toBe("normal");
  expect(
    await page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector('[data-active-tab="true"] .editor-scroll') ??
            document.querySelector(".editor-scroll")!,
        ).backgroundColor,
    ),
    label,
  ).toBe("rgb(1, 2, 3)");
  expect(await computed(page, "#write > p", "text-indent"), label).not.toBe(
    "0px",
  );
  expect(await computed(page, "#write h2", "border-bottom-style"), label).toBe(
    "none",
  );
}

test("custom CSS wins over the Default theme, in light and dark", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", customCss: CUSTOM_CSS } });
  await pasteMarkdown(page, DOC);
  await expectCustomCssWins(page, "default light");
  await setAppearance(page, "Dark");
  await expectCustomCssWins(page, "default dark");
});

test("custom CSS wins over an imported theme, --* variables included", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", customCss: CUSTOM_CSS } });
  await pasteMarkdown(page, DOC);
  const path = "/themes/latex-like.css";
  await installThemeBackend(page, { [path]: fixture("latex-like.css") });
  await importTheme(page, path);
  await expectCustomCssWins(page, "imported light");
  // The user's CSS stays after the theme and its derived chrome.
  const order = await page.evaluate(() =>
    Array.from(document.head.querySelectorAll("style[id]")).map((s) => s.id),
  );
  expect(order.indexOf("textus-user-css")).toBeGreaterThan(
    order.indexOf("textus-custom-theme"),
  );
  expect(order.indexOf("textus-user-css")).toBeGreaterThan(
    order.indexOf("textus-imported-chrome"),
  );
  await setAppearance(page, "Dark");
  await expectCustomCssWins(page, "imported dark");
});

test("the document's look sits in the one textus-content layer", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, DOC);
  const report = await page.evaluate(() => {
    const layers = new Set<string>();
    const layeredFrom = new Set<string>();
    // Unlayered rules from the app's own CSS that set how document text
    // looks on these elements - what a theme or the user's CSS couldn't
    // then override with a plain selector.
    const probes = [
      "#write > p",
      "#write h1",
      "#write h2",
      "#write h3",
      "#write strong",
      "#write em",
      "#write a",
      "#write blockquote",
      "#write p code",
    ]
      .map((s) => document.querySelector(`[data-active-tab="true"] ${s}`))
      .filter((el): el is Element => !!el);
    const looks = [
      "font-family",
      "font-size",
      "font-weight",
      "font-style",
      "line-height",
      "color",
      "text-decoration-line",
    ];
    const unlayered: string[] = [];
    const walk = (rules: CSSRuleList, href: string, layered: boolean) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSLayerBlockRule) {
          layers.add(rule.name);
          layeredFrom.add(href);
          walk(rule.cssRules, href, true);
        } else if (rule instanceof CSSStyleRule) {
          if (!layered && probes.some((el) => el.matches(rule.selectorText))) {
            const set = looks.filter((p) => rule.style.getPropertyValue(p));
            if (set.length) unlayered.push(`${rule.selectorText} {${set}}`);
          }
        } else if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) {
          walk((rule as CSSGroupingRule).cssRules, href, layered);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      const node = sheet.ownerNode as HTMLElement | null;
      const href =
        node?.getAttribute("data-vite-dev-id") ?? node?.id ?? sheet.href ?? "";
      // The theme and the user's CSS are unlayered on purpose.
      if (/textus-(custom-theme|user-css|imported-chrome)/.test(href)) continue;
      // So is the test harness's own no-animation sheet.
      if (!href.includes("/src/")) continue;
      walk(sheet.cssRules, href, false);
    }
    return {
      layers: Array.from(layers),
      layeredFrom: Array.from(layeredFrom),
      unlayered,
    };
  });
  expect(report.layers).toEqual(["textus-content"]);
  expect(report.layeredFrom).toHaveLength(1);
  expect(report.layeredFrom[0]).toContain("content-base.css");
  expect(report.unlayered).toEqual([]);
});

// The CSS's own layer is declared after the app's, so it overrides the
// built-in look.
test("CSS in a layer of its own still overrides the look", async ({ page }) => {
  await openApp(page, {
    settings: {
      language: "en",
      customCss: "@layer mine { h2 { color: rgb(9, 8, 7); } }",
    },
  });
  await pasteMarkdown(page, DOC);
  expect(await computed(page, "#write h2", "color")).toBe("rgb(9, 8, 7)");
});

test("export then import keeps the ornaments and fonts, readable in dark", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, DOC);
  await installThemeBackend(page, {});
  const ORNAMENTS: [string, string][] = [
    ["#write h4::before", "content"],
    ["#write h3", "border-left-style"],
    ["#write h3", "border-left-color"],
    ["#write h2", "border-bottom-style"],
    ["#write blockquote", "background-color"],
    ["#write a", "text-decoration-line"],
    ["#write > p", "font-family"],
    ["#write > p", "font-size"],
    ["#write strong", "font-weight"],
  ];
  const before: string[] = [];
  for (const [sel, prop] of ORNAMENTS)
    before.push((await computed(page, sel, prop)) ?? "");

  const dialog = await openSettings(page);
  await dialog.getByRole("button", { name: "Get more themes" }).click();
  await dialog.getByRole("button", { name: "More", exact: true }).click();
  await dialog.getByRole("menuitem", { name: "Export as CSS…" }).click();
  const css = await page
    .waitForFunction(
      () =>
        (
          window as unknown as {
            __themeStore: { written: Record<string, string> };
          }
        ).__themeStore.written["/exports/textus-theme.css"],
    )
    .then((h) => h.jsonValue() as Promise<string>);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // The page under the text is written out, not left commented.
  expect(css).toMatch(/^\s*--doc-bg:\s*\S/m);
  expect(css).toMatch(/^\s*--doc-font:\s*\S/m);

  await importTheme(page, "/exports/textus-theme.css");
  for (const mode of ["Light", "Dark"] as const) {
    await setAppearance(page, mode);
    for (let i = 0; i < ORNAMENTS.length; i++) {
      const [sel, prop] = ORNAMENTS[i];
      expect(await computed(page, sel, prop), `${mode} ${sel} ${prop}`).toBe(
        before[i],
      );
    }
    const ratios = await contrasts(page, ["#write > p"]);
    expect(ratios["#write > p"], mode).toBeGreaterThanOrEqual(4.5);
  }
});

test("a theme's own transitions survive zen mode and reduced motion", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" }, animations: true });
  await pasteMarkdown(page, DOC);
  const path = "/themes/latex-like.css";
  await installThemeBackend(page, { [path]: fixture("latex-like.css") });
  await importTheme(page, path);
  const transition = () => computed(page, "#write > p", "transition");
  const plain = await transition();
  expect(plain).toContain("color 0.4s");
  await page.locator("#write h2").first().click();
  await page.keyboard.press("ControlOrMeta+Shift+J");
  await expect(page.locator("html")).toHaveClass(/zen/);
  expect(await transition()).toBe(plain);
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).not.toHaveClass(/zen/);
  const fast = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--dur-slow"),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await transition()).toBe(plain);
  const reduced = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--dur-slow"),
  );
  expect(reduced).not.toBe(fast);
});

test("zen mode with no current block dims nothing", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, DOC);
  // Zen on, before the editor has marked a block as the current one (the
  // caret outside the text): every paragraph at a third read as broken.
  await page.evaluate(() => document.documentElement.classList.add("zen"));
  await expect(page.locator(".zen-current")).toHaveCount(0);
  expect(await computed(page, "#write h1", "opacity")).toBe("1");
  // Once there is one, the rest recede.
  await page.locator("#write h2").first().click();
  await expect(page.locator(".zen-current")).toHaveCount(1);
  expect(await computed(page, "#write h1", "opacity")).toBe("0.32");
});

for (const action of ["Import CSS…", "Delete Theme"] as const) {
  test(`Escape still closes Settings after ${action} takes the focus away`, async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    const path = "/themes/pixyll-like.css";
    await installThemeBackend(page, { [path]: fixture("pixyll-like.css") });
    if (action === "Delete Theme") await importTheme(page, path);
    await page.evaluate((p) => {
      (window as unknown as { __nextPick: string }).__nextPick = p;
    }, path);
    // Slow, as the native picker always is: the button is disabled (or
    // gone) while it works, and the focus drops to <body>.
    await page.evaluate(() => {
      (window as unknown as { __themeLatency: number }).__themeLatency = 300;
    });
    const dialog = await openSettings(page);
    if (action === "Import CSS…") {
      await dialog.getByRole("button", { name: "Get more themes" }).click();
      await dialog.getByRole("button", { name: "More", exact: true }).click();
    }
    await dialog
      .getByRole(action === "Import CSS…" ? "menuitem" : "button", {
        name: action,
      })
      .focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
}
