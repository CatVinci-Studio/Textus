import { type Page } from "@playwright/test";

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

/** Whether the page runs on a Mac: Mod is ⌘ there, and keys read so. */
export const MAC = process.platform === "darwin";

/** Opens the app with onboarding done and the given extra localStorage,
 *  and makes rendering deterministic (no animations, no blinking caret).
 *  `animations: true` leaves the motion on, for the specs that test it. */
export async function openApp(
  page: Page,
  options: {
    storage?: Record<string, string>;
    settings?: Record<string, unknown>;
    colorScheme?: "light" | "dark";
    animations?: boolean;
    /** What shows once the window is ready; an editor by default. */
    ready?: string;
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
  // A second open in the same tab starts afresh: the tabs a reload keeps
  // (reload-tabs.ts) belong to the page the test is leaving.
  // The app writes them as the page goes too: a listener added after its
  // own clears them last.
  if (page.url().startsWith("http"))
    await page.evaluate(() => {
      sessionStorage.clear();
      addEventListener("pagehide", () => sessionStorage.clear());
    });
  await page.goto("/");
  if (!options.animations)
    await page.addStyleTag({
      content:
        "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }",
    });
  await page.waitForSelector(
    options.ready ?? '[data-active-tab="true"] .ProseMirror',
  );
}

/** Puts markdown into the active editor the way a paste does. */
export async function pasteMarkdown(page: Page, markdown: string) {
  // The paste may land a moment later: wait until the document changed.
  await page.evaluate(async (md) => {
    const target = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    const before = target.innerHTML;
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
    const end = performance.now() + 3000;
    while (target.innerHTML === before && performance.now() < end)
      await new Promise((resolve) => setTimeout(resolve, 16));
  }, markdown);
  await settled(page);
}

/** Answers a backend command with a canned value. */
export async function mockInvoke(page: Page, results: Record<string, unknown>) {
  await page.evaluate((r) => {
    (window as unknown as { __devInvokeResults: unknown }).__devInvokeResults =
      r;
  }, results);
}

type DevWindow = {
  __devEmitTauriEvent: (name: string, payload?: unknown) => void;
  __devInvokeCalls?: ({ cmd: string } & Record<string, unknown>)[];
  __devHeld?: Record<string, unknown[]>;
  __devRelease: (cmd: string) => void;
};

/** Sends a backend event, as a menu item or the OS would. */
export function emit(page: Page, name: string, payload?: unknown) {
  return page.evaluate(
    ([n, p]) =>
      (window as unknown as DevWindow).__devEmitTauriEvent(n as string, p),
    [name, payload] as const,
  );
}

/** Waits until nothing moves: no animation running and every scroll
 *  position the same for a few frames (at most 3 s). In place of a fixed
 *  pause before checking where things came to rest. */
export function settled(page: Page) {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const positions = () =>
          [document.scrollingElement, ...document.querySelectorAll("*")]
            .filter(
              (el): el is Element =>
                !!el && (el.scrollTop !== 0 || el.scrollLeft !== 0),
            )
            .map((el) => `${el.scrollTop},${el.scrollLeft}`)
            .join(";");
        const running = () =>
          document
            .getAnimations()
            .some(
              (a) =>
                a.playState === "running" &&
                a.effect?.getTiming().iterations !== Infinity,
            );
        const end = performance.now() + 3000;
        let last = positions();
        let still = 0;
        const tick = () => {
          const now = positions();
          still = now === last && !running() ? still + 1 : 0;
          last = now;
          if (still >= 4 || performance.now() > end) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}
