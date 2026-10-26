import { expect, test, type Page } from "@playwright/test";
import { openApp } from "../../helpers";

// Review screenshots of the sidebar with a folder opened and its file-name
// search. Runs only with TEXTUS_SHOTS_DIR set.

const DIR = process.env.TEXTUS_SHOTS_DIR;
test.skip(!DIR, "set TEXTUS_SHOTS_DIR to take the screenshots");

const SETS = {
  en: {
    folder: "/Users/me/Writing/Harbour City",
    files: {
      "Outline.md": "# Outline\n\nThree parts, twelve chapters.",
      "Part 1/Chapter 1 - Arrival.md":
        "# Chapter 1 - Arrival\n\nThe ferry came in under a low sky, and Lin Wan was the last to step off.",
      "Part 1/Chapter 2 - The Market.md": "# Chapter 2 - The Market",
      "Part 1/Chapter 3 - Night Shift.md": "# Chapter 3 - Night Shift",
      "Part 2/Chapter 4 - Letters.md": "# Chapter 4 - Letters",
      "Part 2/Chapter 5 - The Storm.md": "# Chapter 5 - The Storm",
      "Notes/Characters.md": "# Characters",
      "Notes/Places.md": "# Places",
      "Notes/Chapter map.png": "png",
      "Part 2/Chapter 10 - Return.md": "# Chapter 10 - Return",
      "Notes/Research/Ferry timetables.txt": "1962 timetable",
    } as Record<string, string>,
    open: "Part 1/Chapter 1 - Arrival.md",
    expand: ["Part 1", "Notes"],
    query: "chapter",
  },
  zh: {
    folder: "/Users/me/写作/海港城",
    files: {
      "大纲.md": "# 大纲\n\n三部，十二章。",
      "第一部/第一章 到达.md":
        "# 第一章 到达\n\n渡轮在低低的天色里靠岸，林婉最后一个走下船。",
      "第一部/第二章 集市.md": "# 第二章 集市",
      "第一部/第三章 夜班.md": "# 第三章 夜班",
      "第二部/第四章 来信.md": "# 第四章 来信",
      "第二部/第五章 风暴.md": "# 第五章 风暴",
      "资料/人物.md": "# 人物",
      "资料/地点.md": "# 地点",
      "资料/各章地图.png": "png",
      "第二部/第10章 归来.md": "# 第10章 归来",
      "第二部/第2章 补记.md": "# 第2章 补记",
      "资料/考证/渡轮时刻表.txt": "1962 年时刻表",
    } as Record<string, string>,
    open: "第一部/第一章 到达.md",
    expand: ["第一部", "资料"],
    query: "章",
  },
};

async function setUp(page: Page, lang: "en" | "zh", dark: boolean) {
  const set = SETS[lang];
  const files = Object.fromEntries(
    Object.entries(set.files).map(([rel, text]) => [
      `${set.folder}/${rel}`,
      text,
    ]),
  );
  await page.addInitScript(
    ({ files, folder }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__devFs = files;
      w.__devPickFolder = folder;
    },
    { files, folder: set.folder },
  );
  await openApp(page, {
    settings: { language: lang },
    colorScheme: dark ? "dark" : "light",
  });
  // The chapter takes the empty window's tab, as File > Open Recent does.
  await page.evaluate((path) => {
    const emit = (
      window as unknown as {
        __devEmitTauriEvent: (e: string, payload?: unknown) => void;
      }
    ).__devEmitTauriEvent;
    emit("menu-open-folder");
    emit("menu-open-recent", path);
  }, `${set.folder}/${set.open}`);
  await expect(page.locator(".sidebar .tree-root-label")).toBeVisible();
  for (const name of set.expand) {
    const row = page.locator(".sidebar .tree-main .tree-row", {
      hasText: name,
    });
    if (!(await row.locator(".chevron-open").count())) await row.click();
  }
  await page.locator('[data-active-tab="true"] .ProseMirror p').click();
}

for (const lang of ["en", "zh"] as const) {
  for (const dark of [false, true]) {
    const tag = `${lang}-${dark ? "dark" : "light"}`;
    test(`open folder ${tag}`, async ({ page }) => {
      await setUp(page, lang, dark);
      await page.screenshot({ path: `${DIR}/folder-tree-${tag}.png` });
      await page.keyboard.press("ControlOrMeta+Shift+O");
      await page.keyboard.type(SETS[lang].query);
      await page.keyboard.press("ArrowDown");
      await expect(
        page.locator(".file-search-results [role=option]"),
      ).not.toHaveCount(0);
      await page.screenshot({ path: `${DIR}/folder-search-${tag}.png` });
    });
  }
}
