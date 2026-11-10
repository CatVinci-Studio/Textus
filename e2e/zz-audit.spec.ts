import { test, type Page } from "@playwright/test";
import { emit, openApp, pasteMarkdown } from "./helpers";

const PAGES = ["general","look-basic","edit-text","edit-img","edit-export","providers","chat","memory","mcp","shortcuts","privacy","about"];
const DOC = `# 第三章 雨\n\n雨下到第三天，镇上的人开始把**船**拖到门口。\n\n## 清单\n\n- 买米\n- 修屋顶\n  - 东边的瓦\n- [ ] 给老周打电话\n\n> 她说，雨总会停的。\n\n| 日期 | 雨量 |\n| --- | --- |\n| 周一 | 12 mm |\n| 周二 | 30 mm |\n\n\`\`\`js\nconst rain = days.map((d) => d.mm);\n\`\`\`\n`;
const FS = { "/notes/第三章.md": DOC, "/notes/大纲.md": "# 大纲\n\n- 一\n- 二\n", "/notes/人物/老周.md": "# 老周\n", "/notes/人物/小雨.md": "# 小雨\n", "/notes/资料/潮汐表.md": "# 潮汐\n" };
const out = (n: string) => `test-results/audit/${n}.png`;
const page_ = (p: Page, id: string) => p.evaluate((page) => window.dispatchEvent(new CustomEvent("textus:open-settings-page", { detail: { page } })), id);

async function start(page: Page, o: { w?: number; dark?: boolean; lang?: string; folder?: boolean } = {}) {
  if (o.folder) await page.addInitScript((fs) => { const w = window as any; w.__devFs = fs; w.__devPickFolder = "/notes"; }, FS);
  await page.setViewportSize({ width: o.w ?? 1280, height: 800 });
  await openApp(page, { colorScheme: o.dark ? "dark" : "light", settings: { menuBarShown: false, ...(o.lang ? { language: o.lang } : {}) } });
  if (o.folder) { await emit(page, "menu-open-folder"); await page.waitForTimeout(600); }
}
const ai = (page: Page) => page.getByRole("button", { name: "Textus AI" }).first().click();
const settle = (page: Page, ms = 700) => page.waitForTimeout(ms);

for (const dark of [false, true]) {
  const m = dark ? "dark" : "light";
  test(`editor ${m}`, async ({ page }) => {
    await start(page, { dark, folder: true });
    await pasteMarkdown(page, DOC); await settle(page);
    await page.screenshot({ path: out(`editor-files-${m}`) });
    await ai(page); await settle(page, 900); await page.mouse.move(600, 500);
    await page.screenshot({ path: out(`editor-ai-${m}`) });
  });
  test(`sidebars ${m}`, async ({ page }) => {
    await start(page, { dark, folder: true });
    await pasteMarkdown(page, DOC); await settle(page);
    for (const name of ["大纲", "搜索", "插件"]) {
      await page.locator(".activity-rail").getByRole("button", { name }).click(); await settle(page);
      await page.screenshot({ path: out(`sidebar-${name}-${m}`), clip: { x: 0, y: 0, width: 640, height: 800 } });
    }
  });
  test(`settings wide ${m}`, async ({ page }) => {
    await start(page, { dark });
    await emit(page, "menu-open-settings");
    for (const id of dark ? ["general", "look-basic", "providers", "chat", "memory"] : PAGES) {
      await page_(page, id); await settle(page);
      await page.screenshot({ path: out(`settings-${id}-${m}`), fullPage: false });
    }
  });
}
test("settings narrow", async ({ page }) => {
  await start(page, { w: 1200 });
  await emit(page, "menu-open-settings"); await ai(page); await settle(page, 900);
  for (const id of PAGES) { await page_(page, id); await settle(page); await page.mouse.move(10, 790);
    await page.screenshot({ path: out(`narrow-${id}`), clip: { x: 300, y: 0, width: 500, height: 800 } }); }
});
test("small window", async ({ page }) => {
  await start(page, { w: 820, folder: true });
  await pasteMarkdown(page, DOC); await settle(page);
  await page.screenshot({ path: out(`small-editor`) });
  await ai(page); await settle(page, 900); await page.mouse.move(400, 500);
  await page.screenshot({ path: out(`small-editor-ai`) });
});
for (const lang of ["de", "ja", "ru"]) test(`settings ${lang}`, async ({ page }) => {
  await start(page, { lang });
  await emit(page, "menu-open-settings");
  for (const id of PAGES) { await page_(page, id); await settle(page, 500);
    await page.screenshot({ path: out(`lang-${lang}-${id}`) }); }
});
test("ai no doc", async ({ page }) => {
  await start(page);
  await emit(page, "menu-open-settings");
  const doc = page.locator(".tab-pill").filter({ hasText: "未命名" });
  await doc.click(); await doc.hover(); await doc.locator(".tab-pill-close").click();
  await ai(page); await settle(page, 900); await page.mouse.move(400, 790);
  await page.screenshot({ path: out(`ai-nodoc`) });
});
