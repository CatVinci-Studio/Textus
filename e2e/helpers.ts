import { devices, expect, type Page } from "@playwright/test";

/** A document exercising most of the content styling. */
export const SAMPLE_DOC = `# 老城区更新的几点思考

## 背景

城市更新不只是拆旧建新。在老城区，很多居民已经在这里生活了**几十年**，他们的记忆和街道连在一起，公式 $E=mc^2$ 只是一个例子。

这项研究在三个街区进行。我们花了整整两个月的时间，和住在这些街区里的居民进行了一对一的、比较深入的访谈。一共访谈了四十六位居民，内容涵盖了很多方面。

> 大多数受访者并不反对改造，他们真正担心的是临时安置和租金上涨。

| 序号 | 名称 | 数量 | 单价 | 金额 | 备注 | 状态 | 负责人 |
|---|---|---|---|---|---|---|---|
| 1 | 苹果 | 10 | 3.5 | 35 | 无 | 完成 | 张三 |
| 2 | 一个名字比较长的商品条目 | 200 | 12 | 2400 | 加急 | 进行中 | 李四 |

\`\`\`js
console.log("a fairly long first line of code to see whether the language label overlaps it");
\`\`\`

## 结论

- 先听取居民意见
- 再制定方案
`;

/** Opens the app with onboarding done and the given extra localStorage,
 *  and makes rendering deterministic (no animations, no blinking caret).
 *  `animations: true` leaves the motion on, for the specs that test it. */
/** For the first wait on something KaTeX draws: the dev server bundles KaTeX
 *  on its first request, which on a CI runner can exceed the default 5s. */
export const FIRST_LOAD = { timeout: 20_000 };

export async function openApp(
  page: Page,
  options: {
    storage?: Record<string, string>;
    settings?: Record<string, unknown>;
    colorScheme?: "light" | "dark";
    animations?: boolean;
  } = {},
) {
  await page.emulateMedia({ colorScheme: options.colorScheme ?? "light" });
  await page.addInitScript(
    ({ settings, storage }) => {
      // Not in the iframe an imported theme is sampled in: rewriting the settings
      // there fires a storage event that reverts the import.
      if (window.top !== window) return;
      localStorage.setItem(
        "catvinci-settings",
        JSON.stringify({
          language: "zh",
          languageChosen: true,
          onboardingShown: true,
          ...settings,
        }),
      );
      for (const [key, value] of Object.entries(storage)) {
        localStorage.setItem(key, value);
      }
    },
    { settings: options.settings ?? {}, storage: options.storage ?? {} },
  );
  await page.goto("/");
  if (!options.animations)
    await page.addStyleTag({
      content:
        "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }",
    });
  await page.waitForSelector('[data-active-tab="true"] .ProseMirror');
}

/** Puts markdown into the active editor the way a paste does. */
export async function pasteMarkdown(page: Page, markdown: string) {
  await page.evaluate((md) => {
    const target = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    target.focus();
    const data = new DataTransfer();
    data.setData("text/plain", md);
    target.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, markdown);
  await page.waitForTimeout(300);
}

/** The ids of a document's blocks, as the app makes them - its own module,
 *  from the dev server (the e2e project can't import src/). For documents
 *  whose every paragraph the editor writes back as it was pasted. */
export async function blockIds(page: Page, doc: string): Promise<string[]> {
  return page.evaluate(
    async ({ doc, path }) => {
      const mod = (await import(/* @vite-ignore */ path)) as {
        blockIds: (markdowns: string[]) => string[];
      };
      return mod.blockIds(doc.split("\n\n"));
    },
    { doc, path: "/src/ai/doc-blocks.ts" },
  );
}

/** Answers a backend command with a canned value. */
export async function mockInvoke(page: Page, results: Record<string, unknown>) {
  await page.evaluate((r) => {
    (window as unknown as { __devInvokeResults: unknown }).__devInvokeResults =
      r;
  }, results);
}

/** An iPhone, as far as Chromium can be one: touch and a phone-sized
 *  viewport. Playwright can't drive iOS WebKit itself; the layout is keyed
 *  off the platform, which openPhone fakes. For `test.use(PHONE)`. */
export const PHONE = {
  viewport: { width: 430, height: 932 },
  isMobile: true,
  hasTouch: true,
  userAgent: devices["iPhone 15 Pro Max"].userAgent,
};

/** openApp as an iPhone: the phone layout is on. */
export async function openPhone(
  page: Page,
  options: {
    animations?: boolean;
    storage?: Record<string, string>;
    colorScheme?: "light" | "dark";
    /** Settings over English. */
    settings?: Record<string, unknown>;
  } = {},
) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "iPhone" });
  });
  await openApp(page, {
    ...options,
    settings: { language: "en", ...options.settings },
  });
  await expect(page.locator("html")).toHaveAttribute(
    "data-window-chrome",
    "mobile",
  );
}
