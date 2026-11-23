import { expect, test, type Page } from "@playwright/test";
import { emit, openApp } from "./helpers";
import { streamRevise } from "./revise-mock";

/**
 * A rewrite of a whole document with headings, a list, a link and a
 * picture is decided change by change, each new text drawn as what it
 * will be, and Accept writes the rewrite as it was proposed.
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const URL = "https://openreview.net/forum?id=aWVG2rN4OV";
// The file has the address bare, right after "：".
const DOC = [
  "TMLR 2026 · Featured Certification",
  "把时间序列转成图像，再交给视觉模型。它们能识别时序模式吗？",
  `🔗 论文链接：${URL}`,
  "## 02 | 为什么把时间序列转成图像",
  "时间序列分析广泛用于能源、交通等领域。这条路线背后有两个直觉：",
  "- 分类依赖模式识别。\n- 预测需要数值推断。",
  "![八种成像方法](images/fig1.png)",
  "## 03 | 研究设计",
  "本文没有提出新架构。评估它们迁移后的能力。",
].join("\n\n");
const REWRITE = [
  "TMLR 2026 · Featured Certification",
  "把时间序列转成图像，再交给 ViT、MAE 这类视觉模型：它们能识别时序模式吗？",
  `🔗 **论文链接**：[OpenReview](${URL})`,
  "## 02 | 为什么把时间序列转成图像？",
  "时间序列分析广泛用于能源、交通、医疗等领域。这条路线背后有两个直觉：",
  "- **分类依赖模式识别。** 可区分模式转成图像后可被识别。\n- **预测需要数值推断。** 像素与序列结构相似。",
  "![八种成像方法](images/fig1.png)",
  "## 03 | 研究设计：不提新模型",
  "本文没有提出新架构，而是评估它们迁移后的能力。![研究流程](images/flow.png)",
].join("\n\n");

const changes = (page: Page) => page.getByRole("toolbar", { name: "Revision" });

test("a whole-document rewrite shows its structure and saves as proposed", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", autosave: false },
    storage: { "textus-agent-panel-open": "1" },
  });
  await page.evaluate((text) => {
    const w = window as unknown as Record<string, unknown> & {
      __devEmitTauriEvent: (name: string, payload: unknown) => void;
    };
    w.__devFiles = { "/notes/note.md": text };
    w.__devEmitTauriEvent("tauri://drag-drop", {
      paths: ["/notes/note.md"],
      position: { x: 0, y: 0 },
    });
  }, `${DOC}\n`);
  await expect(page.locator(editor)).toContainText("研究设计");
  // The model is shown the address as the editor writes it: `[url](url)`.
  const anchor = DOC.replace(`：${URL}`, `：[${URL}](${URL})`);
  await streamRevise(
    page,
    [{ id: "s1", args: { action: "replace", anchor, text: REWRITE } }],
    { chunk: 40, every: 5 },
  );
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Polish this");
  await composer.press("Enter");
  await expect(page.locator(".agent-panel-view")).toContainText("Tightened.");
  // Found in the text: one change per sentence or block, not the whole
  // document as one.
  await expect(changes(page)).toContainText("7 changes");
  const added = page.locator(`${editor} .pending-insert`);
  // No Markdown shows as text: the link is a link, the list a list.
  await expect(added.filter({ hasText: "](" })).toHaveCount(0);
  await expect(added.filter({ hasText: /^\s*(#|- )/ })).toHaveCount(0);
  await expect(added.locator("a", { hasText: "OpenReview" })).toHaveCount(1);
  await expect(added.locator("ul > li")).toHaveCount(2);
  // A picture of the proposal that isn't there is the missing-picture card,
  // not the webview's broken image.
  const card = added.locator(".missing-image-card");
  await expect(card).toContainText("flow.png");
  await expect(added.locator("img")).toHaveCount(0);

  await changes(page)
    .getByRole("button", { name: "Accept", exact: true })
    .click();
  await emit(page, "menu-save-file");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __devFiles: Record<string, string> })
            .__devFiles["/notes/note.md"],
      ),
    )
    .toBe(`${REWRITE}\n`);
});
