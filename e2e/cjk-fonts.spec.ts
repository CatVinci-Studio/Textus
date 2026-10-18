import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// Han characters are drawn differently in Japanese, Simplified and
// Traditional Chinese and Korean; the font stacks pick the faces for the
// language <html lang> names (App.css), in the chrome and in the content
// themes alike. What's checked is the stack each element resolves to - the
// faces themselves aren't installed on a CI runner.

/** The first CJK face in the font-family of `selector`, under `lang`. */
async function firstCjkFace(page: Page, lang: string, selector: string) {
  return page.evaluate(
    ([lang, selector]) => {
      document.documentElement.lang = lang;
      const family = getComputedStyle(
        document.querySelector(selector)!,
      ).fontFamily;
      const faces = family.split(",").map((f) => f.trim().replace(/"/g, ""));
      return faces.find((f) =>
        /PingFang|Hiragino|Apple|Songti|Noto|Source Han/.test(f),
      );
    },
    [lang, selector],
  );
}

test("the interface font follows the UI language's CJK faces", async ({
  page,
}) => {
  await openApp(page);
  expect(await firstCjkFace(page, "en", "body")).toBe("PingFang SC");
  expect(await firstCjkFace(page, "zh-CN", "body")).toBe("PingFang SC");
  expect(await firstCjkFace(page, "ja", "body")).toBe("Hiragino Sans");
  expect(await firstCjkFace(page, "zh-Hant", "body")).toBe("PingFang TC");
  expect(await firstCjkFace(page, "zh-TW", "body")).toBe("PingFang TC");
  expect(await firstCjkFace(page, "ko", "body")).toBe("Apple SD Gothic Neo");
});

/** Every face in the font-family of `selector`, under `lang`. */
async function faces(page: Page, lang: string, selector: string) {
  return page.evaluate(
    ([lang, selector]) => {
      document.documentElement.lang = lang;
      return getComputedStyle(document.querySelector(selector)!)
        .fontFamily.split(",")
        .map((f) => f.trim().replace(/"/g, ""));
    },
    [lang, selector],
  );
}

test("a Latin face comes before the CJK ones outside Chinese, Japanese and Korean", async ({
  page,
}) => {
  // A CJK face draws ’ full-width: with it ahead of system-ui on Linux,
  // French "d’habitants" showed a gap after the apostrophe.
  await openApp(page);
  for (const selector of ["body", ".milkdown .ProseMirror"]) {
    for (const lang of ["fr", "de", "ru", "en"]) {
      const stack = await faces(page, lang, selector);
      expect(stack.indexOf("system-ui"), `${lang} ${selector}`).toBeLessThan(
        stack.indexOf("PingFang SC"),
      );
    }
    for (const lang of ["zh-CN", "ja", "ko"]) {
      const stack = await faces(page, lang, selector);
      expect(stack.indexOf("system-ui"), `${lang} ${selector}`).toBeGreaterThan(
        stack.findIndex((f) => /PingFang|Hiragino|Apple SD/.test(f)),
      );
    }
  }
});

test("every language falls back to the Simplified Chinese faces last", async ({
  page,
}) => {
  await openApp(page, { settings: { themeId: "paper" } });
  // A Linux machine with only WenQuanYi (or only Noto CJK SC) installed
  // must still find a CJK face named in the stack, in every language - and
  // after that language's own faces, never before them.
  for (const [lang, last] of [
    ["ja", "Meiryo"],
    ["zh-Hant", "Microsoft JhengHei"],
    ["ko", "Malgun Gothic"],
  ]) {
    const stack = await faces(page, lang, "body");
    expect(stack).toContain("WenQuanYi Micro Hei");
    expect(stack.indexOf(last)).toBeGreaterThan(0);
    expect(stack.indexOf("Noto Sans CJK SC")).toBeGreaterThan(
      stack.indexOf(last),
    );
  }
  const editor = '[data-active-tab="true"] .ProseMirror';
  await expect(page.locator("html")).toHaveAttribute(
    "data-content-theme",
    "paper",
  );
  for (const [lang, last] of [
    ["ja", "MS Mincho"],
    ["zh-Hant", "PMingLiU"],
    ["ko", "Batang"],
  ]) {
    const stack = await faces(page, lang, editor);
    expect(stack.indexOf(last)).toBeGreaterThan(0);
    expect(stack.indexOf("Noto Serif CJK SC")).toBeGreaterThan(
      stack.indexOf(last),
    );
  }
});

test("the Paper theme's serif follows the language too", async ({ page }) => {
  await openApp(page, { settings: { themeId: "paper" } });
  const editor = '[data-active-tab="true"] .ProseMirror';
  await expect(page.locator(editor)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-content-theme",
    "paper",
  );
  expect(await firstCjkFace(page, "zh-CN", editor)).toBe("Songti SC");
  expect(await firstCjkFace(page, "ja", editor)).toBe("Hiragino Mincho ProN");
  expect(await firstCjkFace(page, "zh-HK", editor)).toBe("Songti TC");
  expect(await firstCjkFace(page, "ko", editor)).toBe("AppleMyungjo");
});

test("Korean breaks at spaces, in the UI and the document, but not in table cells", async ({
  page,
}) => {
  // keep-all on a table cell made a Chinese cell one unbreakable run, so
  // the table outgrew the page; paragraphs still wrap at the edge.
  await openApp(page, { settings: { language: "ko" } });
  await pasteMarkdown(
    page,
    "메밀꽃 필 무렵\n\n| 인물 | 하는 일 |\n| --- | --- |\n| 허 생원 | 장돌뱅이 |\n",
  );
  const wordBreak = (selector: string) =>
    page.evaluate(
      (selector) =>
        getComputedStyle(document.querySelector(selector)!).wordBreak,
      selector,
    );
  expect(await wordBreak(".window-bar-title")).toBe("keep-all");
  expect(await wordBreak(".milkdown .ProseMirror p")).toBe("keep-all");
  expect(await wordBreak(".milkdown .ProseMirror td p")).toBe("normal");
});

test("Chinese and Japanese UIs take quotes, the ellipsis and the dash from the CJK face", async ({
  page,
}) => {
  await openApp(page);
  const stack = (lang: string, selector: string) =>
    faces(page, lang, selector).then((f) => f[0]);
  const editor = ".milkdown .ProseMirror";
  expect(await stack("zh-CN", "body")).toBe("Textus Punct SC");
  expect(await stack("zh-CN", editor)).toBe("Textus Punct SC");
  expect(await stack("zh-Hant", "body")).toBe("Textus Punct TC");
  expect(await stack("ja", "body")).toBe("Textus Punct JP");
  // Elsewhere the faces stay out, so English and French quotes and
  // apostrophes keep their Latin shapes.
  for (const lang of ["en", "fr", "ko"])
    expect(await stack(lang, "body")).toBe("Textus No Punct");
});

test("source mode names a mono face for Latin and a sans face for CJK before the generic monospace (#132)", async ({
  page,
}) => {
  // WebView2 in a Chinese Windows resolves `monospace` to NSimSun: with no
  // named face holding Chinese ahead of it, source mode showed SimSun.
  await openApp(page);
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string) => void;
      }
    ).__devEmitTauriEvent("menu-toggle-source-mode"),
  );
  const source = '[data-active-tab="true"] textarea.source-view';
  await expect(page.locator(source)).toBeAttached();
  for (const [lang, cjk] of [
    ["zh-CN", "Microsoft YaHei"],
    ["en", "Microsoft YaHei"],
    ["ja", "Yu Gothic UI"],
  ]) {
    const stack = await faces(page, lang, source);
    expect(stack.indexOf("Consolas"), lang).toBeGreaterThan(-1);
    expect(stack.indexOf(cjk), lang).toBeGreaterThan(
      stack.indexOf("Liberation Mono"),
    );
    expect(stack.at(-1), lang).toBe("monospace");
  }
});
