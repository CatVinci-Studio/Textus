/**
 * The official plugins' market pictures: each plugin at work in a 1200x750
 * window, light appearance, written to `screenshots/1.png` beside its
 * manifest in the textus-plugins checkout the dev server serves. Not a
 * test: run `npm run screenshots:plugins`, look, then commit them there.
 *
 * PLUGINS narrows the run to some ids, comma-separated.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, pasteMarkdown } from "../../helpers";
import {
  hasPlugin,
  openPath,
  openSidebarList,
  openSidebarTab,
  openWithPlugins,
  tabFrame,
  type PluginsAtStart,
} from "../../plugin-helpers";
import { pluginsCheckout } from "../../../vite.dev-plugins";
import JSZip from "jszip";

const editor = '[data-active-tab="true"] .ProseMirror';
const only = process.env.PLUGINS?.split(",").filter(Boolean);

const run = (page: Page, command: string) =>
  page.evaluate(
    (id) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (n: string, p: unknown) => void;
        }
      ).__devEmitTauriEvent("menu-plugin-command", id),
    command,
  );

async function open(
  page: Page,
  id: string,
  grants: string[],
  folder: Record<string, string>,
  path: string,
  extra: Partial<PluginsAtStart> & { language?: string } = {},
) {
  await openWithPlugins(page, {
    plugins: { [id]: grants },
    folder,
    ...extra,
  });
  await openPath(page, path);
}

/** The drawing of the first chart block in the open document. */
const chart = (page: Page) =>
  page
    .frameLocator('[data-active-tab="true"] .plugin-code-block iframe')
    .first()
    .locator("#chart svg, #chart canvas")
    .first();

const CHARTS: Record<
  string,
  [language: string, intro: string, source: string]
> = {
  "catvinci.markmap": [
    "markmap",
    "Plan the term as a mind map, written as a Markdown outline.",
    "# Autumn term\n## Reading\n- Woolf\n- Calvino\n- Borges\n## Writing\n- Weekly essay\n- Short story\n## Talks\n- Guest lecture\n- Reading night",
  ],
  "catvinci.echarts": [
    "echarts",
    "Words written each week, drawn with ECharts.",
    '{ tooltip: {}, xAxis: { type: "category", data: ["W1", "W2", "W3", "W4", "W5", "W6"] }, yAxis: { type: "value" }, series: [{ type: "bar", data: [3200, 4100, 2800, 5200, 4700, 6100], itemStyle: { borderRadius: [6, 6, 0, 0] } }] }',
  ],
  "catvinci.plantuml": [
    "plantuml",
    "How a draft is reviewed, as a PlantUML sequence diagram.",
    "@startuml\nactor Author\nparticipant Editor\nparticipant Printer\nAuthor -> Editor : Send draft\nEditor --> Author : Notes\nAuthor -> Editor : Revised draft\nEditor -> Printer : Final files\nPrinter --> Editor : Proof\n@enduml",
  ],
  "catvinci.chartjs": [
    "chartjs",
    "Readers by month, drawn with Chart.js.",
    '{ type: "line", data: { labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], datasets: [{ label: "Readers", data: [120, 190, 260, 240, 380, 450], tension: 0.35, fill: true }] } }',
  ],
  "catvinci.timeline": [
    "timeline",
    "The book's way to print.",
    "2025-01 | First draft | written over the winter\n2025-04 | Second draft | the middle rewritten\n2025-07 | Edit | with the publisher\n2025-10 | Proofs | last corrections\n2026-02 | Published | in shops",
  ],
  "catvinci.abc": [
    "abc",
    "A tune in ABC notation, drawn as sheet music.",
    "X:1\nT:Morning Walk\nM:4/4\nL:1/8\nK:G\n|: GABc d2 B2 | c2 A2 B2 G2 | ABcd e2 c2 | d2 B2 A4 :|\n|: d2 g2 f2 e2 | d2 B2 c2 A2 | B2 G2 A2 F2 | G8 :|",
  ],
  "catvinci.wavedrom": [
    "wavedrom",
    "A bus read, drawn with WaveDrom.",
    '{ signal: [ { name: "clk", wave: "p.......|.." }, { name: "req", wave: "0.1..0...|.." }, { name: "addr", wave: "x.=..x...|..", data: ["A1"] }, { name: "ack", wave: "0...1.0..|.." }, { name: "data", wave: "x...=.x..|..", data: ["D1"] } ] }',
  ],
  "catvinci.function-plot": [
    "function-plot",
    "Damped motion, plotted from its formula.",
    "exp(-x/4) * sin(2x)",
  ],
};

/** A one-page letter: a title, a date and three paragraphs on an A4 page. */
async function letterDocx(): Promise<string> {
  const run = (text: string, props = "") =>
    `<w:p><w:pPr><w:spacing w:after="200"/></w:pPr><w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const body = [
    run("Letter from the Island", '<w:b/><w:sz w:val="40"/>'),
    run("27 October 2026", '<w:color w:val="666666"/>'),
    run("Dear Tomas,"),
    run(
      "The ferries stopped last week, and the island is quiet again. I have started on the keeper's old logs: forty years of weather, ships and the occasional complaint about the oil.",
    ),
    run(
      "The lamp is lit every night now. On clear evenings I can see the lights of the mainland, and I think of you writing at the kitchen table.",
    ),
    run("With love, Mara"),
  ].join("");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "base64" });
}

const shots: Record<string, (page: Page) => Promise<void>> = {};

for (const [id, [language, intro, source]] of Object.entries(CHARTS))
  shots[id] = async (page) => {
    await open(
      page,
      id,
      [],
      {
        "/notes/Notes.md": `# Notes\n\n${intro}\n\n\`\`\`${language}\n${source}\n\`\`\`\n`,
      },
      "/notes/Notes.md",
    );
    await expect(chart(page)).toBeVisible({ timeout: 30_000 });
  };

const ESSAY = `# The Lighthouse Keeper

## Arrival

She came to the island in late October, when the ferries had already stopped. The keeper's cottage smelled of salt and paraffin.

## The first winter

Storms came in from the west every few days. She learned to read the sky the way the old keeper had: by the colour of the light at four o'clock.

## Visitors

In spring the birdwatchers returned, and with them the questions she had no answers to.
`;

shots["catvinci.markdown-lint"] = async (page) => {
  await open(
    page,
    "catvinci.markdown-lint",
    ["editor.read", "editor.write"],
    {
      "/notes/Draft.md":
        "# Draft:\n\n## Chapter one:\n\nThe morning was grey and the harbour quiet.  \n\n* one list\n- another list\n\n### Skipped a level\n\nText.\n",
    },
    "/notes/Draft.md",
  );
  await expect(
    page.locator(`${editor} .plugin-mark-underline`).first(),
  ).toBeVisible({ timeout: 15_000 });
  await page.locator(`${editor} .plugin-mark-underline`).first().hover();
};

shots["catvinci.cjk-spacing"] = async (page) => {
  await open(
    page,
    "catvinci.cjk-spacing",
    ["editor.read", "editor.write"],
    {
      "/notes/笔记.md":
        "# 读书笔记\n\n今天读完了Virginia Woolf的《到灯塔去》，一共用了3个晚上。\n\n书里写Ramsay一家在Skye岛上的两个夏天，中间隔了10年。\n",
    },
    "/notes/笔记.md",
    { language: "zh" },
  );
  await expect(page.locator(editor)).toContainText("读书笔记");
  await run(page, "catvinci.cjk-spacing.space");
  await expect(page.locator(editor)).toContainText("Virginia Woolf 的");
};

shots["catvinci.heading-numbers"] = async (page) => {
  await open(
    page,
    "catvinci.heading-numbers",
    ["editor.read"],
    { "/notes/Report.md": ESSAY.replace("# The", "# Report: The") },
    "/notes/Report.md",
  );
  await expect(page.locator(editor)).toContainText("Arrival");
  await page.waitForTimeout(1500);
};

shots["catvinci.templates"] = async (page) => {
  await open(
    page,
    "catvinci.templates",
    ["files.read", "files.write", "editor.read", "editor.write"],
    { "/notes/Ideas.md": "# Ideas\n" },
    "/notes/Ideas.md",
  );
  await expect(page.locator(editor)).toContainText("Ideas");
  await run(page, "catvinci.templates.new");
  await expect(
    page.getByRole("dialog", { name: "Choose a template" }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await page.locator(".app-dialog-input").fill("Team meeting");
  await page.keyboard.press("Enter");
  await expect(page.locator(`${editor} h2`).first()).toBeVisible();
  await page.locator(`${editor} li p`).first().click();
  await page.keyboard.type("Mara, Tomas, the ferry office");
};

shots["catvinci.bookmarks"] = async (page) => {
  await open(
    page,
    "catvinci.bookmarks",
    ["editor.read", "files.read"],
    { "/notes/The Lighthouse Keeper.md": ESSAY },
    "/notes/The Lighthouse Keeper.md",
  );
  for (const words of ["She came to the island", "Storms came in"]) {
    await page
      .locator(`${editor} p`, { hasText: words })
      .click({ clickCount: 3 });
    await run(page, "catvinci.bookmarks.add");
    await page.waitForTimeout(400);
  }
  await page.locator(`${editor} h1`).click();
  await openSidebarList(page, "Bookmarks");
};

shots["catvinci.quick-notes"] = async (page) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.quick-notes": ["editor.write"] },
  });
  await pasteMarkdown(page, ESSAY);
  const panel = await openSidebarTab(page, "Quick Notes");
  const notes = [
    "The keeper's log: check the 1962 entries",
    "Ask the ferry office about winter crossings",
  ];
  for (const [i, note] of notes.entries()) {
    await panel.getByRole("button", { name: "New" }).click();
    await expect(panel.locator("textarea")).toHaveCount(i + 1);
    const empty = panel.locator("textarea").filter({ hasText: /^$/ });
    await empty.first().fill(note);
    await page.waitForTimeout(400);
  }
  await page.locator(`${editor} h1`).click();
};

shots["catvinci.daily-notes"] = async (page) => {
  await open(
    page,
    "catvinci.daily-notes",
    ["files.read", "files.write", "editor.read"],
    {
      "/notes/Ideas.md": "# Ideas\n\n- A story told by the lighthouse itself\n",
    },
    "/notes/Ideas.md",
  );
  const calendar = await openSidebarTab(page, "Calendar");
  await expect(calendar.locator(".day").first()).toBeVisible();
};

shots["catvinci.tasks"] = async (page) => {
  await open(
    page,
    "catvinci.tasks",
    ["files.read", "files.write"],
    {
      "/notes/Book plan.md":
        "# Book plan\n\n## This week\n\n- [ ] Rewrite the arrival scene 📅 2026-10-28\n- [ ] Ask Mara for the ferry timetable\n- [x] Pick a title\n\n## Later\n\n- [ ] Map of the island\n- [ ] Read the keeper's log\n",
      "/notes/Research.md":
        "# Research\n\n- [ ] Storm records for 1962\n- [ ] Visit the maritime museum 📅 2026-11-02\n",
    },
    "/notes/Book plan.md",
  );
  const tasks = await openSidebarList(page, "Tasks");
  await expect(tasks.locator(".plugin-list-row").first()).toBeVisible();
};

shots["catvinci.kanban"] = async (page) => {
  const board =
    "---\nkanban-plugin: basic\n---\n\n## Ideas\n\n- [ ] A story told by the lighthouse\n- [ ] The ferryman's daughter\n\n## Writing\n\n- [ ] Arrival\n- [ ] The first winter\n\n## Editing\n\n- [ ] Visitors\n\n## Done\n\n- [x] Outline\n";
  await open(
    page,
    "catvinci.kanban",
    ["files.read", "files.write"],
    { "/notes/Book.kanban.md": board },
    "/notes/Book.kanban.md",
  );
  await expect(tabFrame(page).locator(".list")).toHaveCount(4);
};

shots["catvinci.version-history"] = async (page) => {
  await open(
    page,
    "catvinci.version-history",
    ["files.read", "editor.read", "editor.propose"],
    { "/notes/Essay.md": ESSAY },
    "/notes/Essay.md",
    { settings: { "catvinci.version-history": { every: "0" } } },
  );
  const save = () =>
    page.evaluate(() =>
      (
        window as unknown as { __devEmitTauriEvent: (n: string) => void }
      ).__devEmitTauriEvent("menu-save-file"),
    );
  for (const words of [" The lamp turned all night.", " Nobody wrote back."]) {
    await page.locator(`${editor} p`).first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(words);
    await save();
    await page.waitForTimeout(600);
  }
  const history = await openSidebarTab(page, "History");
  await expect(
    history.locator("#versions > li:not(.day-head)").first(),
  ).toBeVisible();
};

shots["catvinci.graph"] = async (page) => {
  await open(
    page,
    "catvinci.graph",
    ["files.read", "editor.read"],
    {
      "/notes/Island.md":
        "# Island\n\nThe [[Lighthouse]] stands on the west cliff; the [[Harbour]] faces east.\n",
      "/notes/Lighthouse.md":
        "# Lighthouse\n\nKept by [[Mara]] since the winter. See [[Storms]].\n",
      "/notes/Harbour.md": "# Harbour\n\nThe [[Ferry]] stops here in summer.\n",
      "/notes/Mara.md": "# Mara\n\nThe keeper. Writes to [[Tomas]].\n",
      "/notes/Tomas.md": "# Tomas\n\nOn the mainland.\n",
      "/notes/Storms.md": "# Storms\n\nFrom the west, every few days.\n",
      "/notes/Ferry.md": "# Ferry\n\nStops in October.\n",
    },
    "/notes/Island.md",
  );
  await run(page, "catvinci.graph.open");
  await expect(tabFrame(page).locator("canvas")).toBeVisible();
  await page.waitForTimeout(2500);
};

shots["catvinci.quick-preview"] = async (page) => {
  await open(
    page,
    "catvinci.quick-preview",
    ["editor.read", "files.read"],
    {
      "/notes/Island.md":
        "# Island\n\nThe lighthouse stands on the west cliff. In winter, [the storms](Storms.md#from-the-west) come in every few days.\n",
      "/notes/Storms.md":
        "# Storms\n\n## From the west\n\nThey come in every few days from October on. The light turns copper at four o'clock and the ferries stop.\n\n## Records\n\nNothing before 1962.\n",
    },
    "/notes/Island.md",
  );
  const link = page.locator(`${editor} a`, { hasText: "the storms" });
  await expect(async () => {
    await page.mouse.move(0, 0);
    await link.hover();
    await expect(page.locator(".hover-card")).toBeVisible({ timeout: 1500 });
  }).toPass();
};

shots["catvinci.latex-completion"] = async (page) => {
  await open(
    page,
    "catvinci.latex-completion",
    ["editor.read"],
    {
      "/notes/Maths.md":
        "# Maths\n\nThe area under the curve is $x$ here.\n\nPlain words.\n",
    },
    "/notes/Maths.md",
  );
  await page
    .locator(`${editor} p`, { hasText: "area" })
    .click({ position: { x: 2, y: 8 } });
  await page.keyboard.press("Home");
  for (let i = 0; i < "The area under the curve is x".length + 1; i++)
    await page.keyboard.press("ArrowRight");
  await page.keyboard.type(" = \\in");
  await expect(
    page.locator(".completion-list:not([hidden]) .completion-item").first(),
  ).toBeVisible();
};

shots["catvinci.vim"] = async (page) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.vim": ["editor.input"] },
  });
  await pasteMarkdown(page, ESSAY);
  await expect(page.locator(".window-bar .plugin-status-item")).toContainText(
    "NORMAL",
  );
  await page.locator(`${editor} p`).first().click();
};

shots["catvinci.emacs"] = async (page) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.emacs": ["editor.input"] },
  });
  await pasteMarkdown(page, ESSAY);
  await page.locator(`${editor} p`).first().click();
  await page.waitForTimeout(800);
};

shots["catvinci.zotero"] = async (page) => {
  const items = [
    ["darwin1859", "On the Origin of Species", "Darwin", "1859"],
    ["carson1962", "Silent Spring", "Carson", "1962"],
    ["wulf2015", "The Invention of Nature", "Wulf", "2015"],
  ].map(([citationKey, title, lastName, date], i) => ({
    key: `KEY${i}`,
    data: {
      title,
      creators: [{ creatorType: "author", lastName }],
      date,
      citationKey,
    },
  }));
  await openWithPlugins(page, {
    plugins: {
      "catvinci.zotero": [
        "network:localhost:23119",
        "editor.write",
        "editor.read",
      ],
    },
  });
  await pasteMarkdown(
    page,
    "# Field notes\n\nAs naturalists have long argued ",
  );
  await mockInvoke(page, {
    plugin_http: {
      status: 200,
      headers: {},
      body: Buffer.from(JSON.stringify(items)).toString("base64"),
    },
  });
  await page.locator(`${editor} p`).click();
  await page.keyboard.press("End");
  await run(page, "catvinci.zotero.cite");
  await page.locator(".app-dialog-input").fill("on");
  await page.keyboard.press("Enter");
  await expect(page.locator(".quick-pick-item").first()).toBeVisible();
};

shots["catvinci.image-viewer"] = async (page) => {
  const png = readFileSync(
    join(import.meta.dirname, "../../../src-tauri/icons/icon.png"),
  ).toString("base64");
  await open(page, "catvinci.image-viewer", [], {}, "/notes/Icon.png", {
    binary: { "/notes/Icon.png": png },
  });
  await expect(tabFrame(page).locator("#info")).toContainText("×");
};

shots["catvinci.pdf-viewer"] = async (page) => {
  const pdf = readFileSync(
    join(import.meta.dirname, "../../fixtures/cjk-cmap.pdf"),
  ).toString("base64");
  await open(page, "catvinci.pdf-viewer", [], {}, "/notes/Poem.pdf", {
    binary: { "/notes/Poem.pdf": pdf },
  });
  await expect(tabFrame(page).locator(".page canvas").first()).toBeVisible({
    timeout: 20_000,
  });
};

shots["catvinci.word-reader"] = async (page) => {
  await open(page, "catvinci.word-reader", [], {}, "/notes/Letter.docx", {
    binary: {
      "/notes/Letter.docx": await letterDocx(),
    },
  });
  await expect(tabFrame(page).locator("section.docx")).toBeVisible({
    timeout: 15_000,
  });
};

shots["catvinci.web-view"] = async (page) => {
  await page.route("https://example.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body style="font-family: Georgia, serif; max-width: 640px; margin: 48px auto; line-height: 1.6; color: #222">
<h1>Lighthouses of the North Sea</h1>
<p>Most of the lights were automated by the 1990s. A few keepers stayed on, and their logs are now kept by the maritime museum.</p>
<h2>Visiting</h2><p>Ferries run from April to October.</p></body></html>`,
    }),
  );
  await openWithPlugins(page, {
    plugins: { "catvinci.web-view": ["network:*", "editor.read"] },
  });
  await pasteMarkdown(page, "https://example.test/lighthouses");
  await page.locator(editor).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.locator(editor).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open or search the selection in a tab" })
    .click();
  await expect(
    page.frameLocator('[data-active-tab="true"] .web-page-frame').locator("h1"),
  ).toBeVisible();
};

// A Mac, as the website's shots: the title row leaves its corner to the
// traffic lights instead of drawing window buttons.
test.use({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
});

for (const [id, shoot] of Object.entries(shots)) {
  if (only && !only.includes(id)) continue;
  test(id, async ({ page }) => {
    test.skip(!hasPlugin(id), `${id} is not in this checkout`);
    test.setTimeout(90_000);
    // On a Mac, Web View opens a native page the browser can't show.
    if (id !== "catvinci.web-view")
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
      });
    await shoot(page);
    await page.waitForTimeout(700);
    const dir = join(pluginsCheckout()!, "plugins", id, "screenshots");
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, "1.png") });
  });
}
