import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { SAMPLE_DOC, mockInvoke, openApp, pasteMarkdown } from "./helpers";
import { streamRevise } from "./revise-mock";

/**
 * Accessibility for screen readers: axe-core over the main screens in the
 * light and the dark appearance, failing on a serious or critical
 * violation, and the announcements a screen reader hears from Textus AI.
 * A11Y_REPORT=1 prints every violation, of any impact, instead of failing -
 * an audit of the moderate ones too.
 */

const FILES: Record<string, string> = {
  "/work/notes/a.md": "# Alpha\n\nFirst note.\n\n## Part\n\nMore.",
  "/work/notes/b.md": "# Beta",
  "/work/notes/novel/ch1.md": "# Chapter one",
};

const editor = '[data-active-tab="true"] .ProseMirror';

async function scan(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  if (process.env.A11Y_REPORT) {
    for (const v of results.violations)
      console.log(
        [
          "A11Y",
          name,
          v.impact,
          v.id,
          v.nodes.length,
          v.nodes
            .slice(0, 4)
            .map((n) => n.target.join(" "))
            .join(" | "),
        ].join("\t"),
      );
    return;
  }
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      id: v.id,
      nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    }));
  expect(blocking, name).toEqual([]);
}

function emit(page: Page, event: string, payload?: unknown) {
  return page.evaluate(
    ([name, value]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent(name as string, value),
    [event, payload] as const,
  );
}

async function open(
  page: Page,
  colorScheme: "light" | "dark" = "light",
  agent = false,
) {
  await page.addInitScript((files) => {
    (window as unknown as { __devFs: unknown }).__devFs = files;
  }, FILES);
  await openApp(page, {
    colorScheme,
    settings: { language: "en" },
    storage: agent ? { "levis-agent-panel-open": "1" } : {},
  });
}

/** Textus AI proposes one rewrite of the first sentence. */
async function propose(page: Page) {
  await pasteMarkdown(page, "The cat sat on the mat.\n\nIt was warm.");
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      {
        kind: "ToolCall",
        call_id: "c1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: "The cat sat on the mat.",
          text: "The cat lay on the rug.",
        }),
      },
      { kind: "ToolResult", call_id: "c1", output: "Edit proposed" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  await send(page);
  await expect(page.locator(".review-bar-accept")).toBeEnabled();
}

async function send(page: Page) {
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Tighten it");
  await composer.press("Enter");
}

const liveRegion = (page: Page) => page.locator('[role="status"][aria-live]');

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe, ${colorScheme}`, () => {
    test("the editor, its tabs and its menus", async ({ page }) => {
      await open(page, colorScheme);
      await pasteMarkdown(page, SAMPLE_DOC);
      // A second tab, as the AI panel's project bar opens one.
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("textus:open-file-in-tab", {
            detail: "/work/notes/a.md",
          }),
        ),
      );
      await expect(page.locator(".tab-pill")).toHaveCount(2);
      await scan(page, `editor ${colorScheme}`);

      await page.locator(".window-menu-button").click();
      await expect(page.locator(".app-menu-list")).toBeVisible();
      await scan(page, `app menu ${colorScheme}`);
      await page.keyboard.press("Escape");

      await page.locator(`${editor} h1`).click({ button: "right" });
      await expect(page.locator(".context-menu")).toBeVisible();
      await scan(page, `context menu ${colorScheme}`);
    });

    test("the sidebar: files, outline and search", async ({ page }) => {
      await open(page, colorScheme);
      await page.evaluate(() => {
        (window as unknown as { __devPickFolder: string }).__devPickFolder =
          "/work/notes";
      });
      await emit(page, "menu-open-folder");
      await page.locator(".sidebar .tree-row", { hasText: "a.md" }).click();
      await expect(page.locator(`${editor} h1`)).toContainText("Alpha");
      await scan(page, `sidebar files ${colorScheme}`);

      await page.getByRole("button", { name: "Outline" }).click();
      await expect(page.locator(".outline-row")).toHaveCount(2);
      await scan(page, `sidebar outline ${colorScheme}`);

      await page.getByRole("button", { name: "Files" }).click();
      await page
        .getByRole("combobox", { name: "Search file names" })
        .fill("ch");
      await expect(page.getByRole("option")).toHaveCount(1);
      await scan(page, `sidebar search ${colorScheme}`);
    });

    test("the AI panel: chat and memory", async ({ page }) => {
      await open(page, colorScheme, true);
      await expect(page.locator(".agent-panel-view")).toBeVisible();
      await scan(page, `ai chat ${colorScheme}`);
      await page.locator("#agent-tab-memory").click();
      await expect(page.locator("#agent-tab-memory")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await scan(page, `ai memory ${colorScheme}`);
    });

    test("a proposal: the review bar and the margin cards", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, colorScheme, true);
      await propose(page);
      await scan(page, `proposal ${colorScheme}`);
      await page.keyboard.press("Control+Shift+L");
      await expect(page.locator(".revision-note")).toHaveCount(1);
      await scan(page, `margin ${colorScheme}`);
    });

    test("every page of Settings, and About", async ({ page }) => {
      await open(page, colorScheme);
      await emit(page, "menu-open-settings");
      const nav = page.locator(".settings-nav-item");
      await expect(nav.first()).toBeVisible();
      for (let i = 0; i < (await nav.count()); i++) {
        await nav.nth(i).click();
        await expect(nav.nth(i)).toHaveAttribute("aria-current", "page");
        await scan(page, `settings ${i} ${colorScheme}`);
      }
      await nav.first().click();
      await page.getByRole("button", { name: "About Textus" }).click();
      await expect(page.getByRole("region", { name: "About" })).toBeVisible();
      await scan(page, `about ${colorScheme}`);

      await page.locator(".settings-nav-item").nth(1).click();
      await page.getByRole("button", { name: "More themes" }).click();
      await expect(
        page.getByRole("region", { name: "More themes" }),
      ).toBeVisible();
      await scan(page, `more themes ${colorScheme}`);
    });

    test("a dialog", async ({ page }) => {
      await open(page, colorScheme);
      void page
        .evaluate(async () => {
          const url = "/src/ui/app-dialog.tsx";
          const dialogs = await import(/* @vite-ignore */ url);
          return dialogs.showConfirm("Delete it?", {
            title: "Delete",
            okLabel: "Delete",
            cancelLabel: "Cancel",
            danger: true,
          });
        })
        .catch(() => {});
      await expect(page.getByRole("dialog", { name: "Delete" })).toBeVisible();
      await scan(page, `dialog ${colorScheme}`);
    });
  });
}

test.describe("axe, newer surfaces", () => {
  const source = {
    n: 1,
    url: "https://sea.example/tides",
    title: "Tide tables",
  };

  test("a reply's web sources and a proposal's footnote box", async ({
    page,
  }) => {
    await open(page, "light", true);
    await mockInvoke(page, {
      ai_agent_message: [
        { kind: "User", text: "Add when spring tides come" },
        {
          kind: "ToolCall",
          call_id: "p1",
          name: "propose_edit",
          arguments: JSON.stringify({
            action: "append",
            text: `Spring tides come at new and full moon [1](${source.url}).`,
          }),
        },
        { kind: "ToolResult", call_id: "p1", output: "Edit proposed" },
        { kind: "Assistant", text: "Added it [1].", sources: [source] },
      ],
    });
    await send(page);
    await expect(page.getByRole("group", { name: "Sources" })).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Add sources as footnotes" }),
    ).toBeVisible();
    await scan(page, "web sources");
  });

  test("a proposed picture's card", async ({ page }) => {
    await page.addInitScript((files) => {
      (window as unknown as { __devFs: unknown }).__devFs = files;
    }, FILES);
    await openApp(page, {
      settings: { language: "en", imageModelProvider: "openai" },
      storage: { "levis-agent-panel-open": "1" },
    });
    const first = "The harbour was quiet before the boats came in.";
    await pasteMarkdown(page, `${first}\n\nThe second paragraph.`);
    await mockInvoke(page, {
      ai_agent_message: [
        { kind: "User", text: "Illustrate it" },
        {
          kind: "ToolCall",
          call_id: "g1",
          name: "generate_image",
          arguments: JSON.stringify({
            prompt: "A quiet harbour at dusk",
            alt: "A quiet harbour",
            action: "insert_after",
            anchor: first,
            image: { id: "abc123", width: 1, height: 1 },
          }),
        },
        {
          kind: "ToolResult",
          call_id: "g1",
          output: "Image proposed - the user now sees the picture.",
        },
        { kind: "Assistant", text: "A harbour at dusk." },
      ],
      ai_generated_image: {
        mime: "image/png",
        ext: "png",
        dataBase64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      },
    });
    await send(page);
    await expect(page.locator(".agent-proposal-picture")).toHaveCount(1, {
      timeout: 10_000,
    });
    await scan(page, "picture proposal");

    // And the image model's rows in Settings, with a model chosen.
    await emit(page, "menu-open-settings");
    await page.locator(".settings-nav-item", { hasText: "Textus AI" }).click();
    await scan(page, "image model setting");
  });

  test("the review bar's offer to remember a requirement", async ({ page }) => {
    await open(page, "light", true);
    await pasteMarkdown(
      page,
      "会议记录：经理说「下周再议」。小李回答「没问题」。\n\n第二天，大家都说「辛苦了」。",
    );
    const workspace = {
      instructions: [],
      project_instructions: "",
      skills: [],
      root: null,
      style: null,
      library: [],
      memories: { items: [], chars: 0, cap: 4000 },
      remember: false,
      levis_project: false,
    };
    const rounds: [string, string, string, number][] = [
      [
        "p1",
        "会议记录：经理说「下周再议」。小李回答「没问题」。",
        "会议记录：经理说“下周再议”。小李回答“没问题”。",
        2,
      ],
      ["p2", "第二天，大家都说「辛苦了」。", "第二天，大家都说“辛苦了”。", 1],
    ];
    for (const [id, anchor, text, changes] of rounds) {
      await mockInvoke(page, {
        load_agent_workspace: workspace,
        ai_agent_message: [
          { kind: "User", text: "polish" },
          {
            kind: "ToolCall",
            call_id: id,
            name: "propose_edit",
            arguments: JSON.stringify({ action: "replace", anchor, text }),
          },
          { kind: "ToolResult", call_id: id, output: "Edit proposed" },
          { kind: "Assistant", text: "Polished." },
        ],
      });
      await send(page);
      await expect(page.locator(".milkdown .pending-sentence")).toHaveCount(
        changes,
      );
      await page
        .locator(".review-bar:not(.learn-bar)")
        .getByRole("button", { name: "Reject" })
        .click();
    }
    await expect(page.locator(".learn-bar")).toContainText("Remember this?");
    await scan(page, "learn bar");
  });
});

test("the editor is a labelled, multi-line text box", async ({ page }) => {
  await open(page);
  const box = page.getByRole("textbox", { name: "Document" });
  await expect(box).toHaveAttribute("aria-multiline", "true");
  await expect(box).toHaveAttribute("contenteditable", "true");
});

test("a proposal reads as a deletion and an insertion, and its card says what it replaces", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "light", true);
  await propose(page);
  await expect(page.locator(`${editor} [role="deletion"]`)).toHaveText(
    "The cat sat on the mat.",
  );
  await expect(page.locator(`${editor} [role="insertion"]`)).toContainText(
    "The cat lay on the rug.",
  );
  await page.keyboard.press("Control+Shift+L");
  const card = page.getByRole("group", { name: "Revision 1" });
  await expect(card).toContainText("The cat sat on the mat.");
  await expect(card).toContainText("The cat lay on the rug.");
});

test("Textus AI's work is announced: writing, the changes, and the decision", async ({
  page,
}) => {
  await open(page, "light", true);
  await pasteMarkdown(page, "The cat sat on the mat.\n\nIt was warm.");
  const args = {
    action: "replace",
    anchor: "The cat sat on the mat.",
    text: "The cat lay on the rug.",
  };
  // Slow enough that the start is heard on its own.
  await streamRevise(page, [{ id: "c1", args }], { every: 200 });
  await send(page);
  await expect(liveRegion(page)).toHaveText("Textus AI is writing…");
  await expect(page.locator(".review-bar-accept")).toBeEnabled({
    timeout: 10_000,
  });
  await expect(liveRegion(page)).toHaveText(
    "1 change proposed. Textus AI is done.",
  );
  await page.locator(".review-bar-accept").click();
  await expect(liveRegion(page)).toContainText("1 change accepted.");
});
