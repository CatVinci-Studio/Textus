import { expect, test } from "@playwright/test";
import { mockInvoke, openApp } from "../../helpers";

// Review screenshots of what Textus AI remembers, in English and Chinese,
// light and dark. Runs only with TEXTUS_SHOTS_DIR set.

const DIR = process.env.TEXTUS_SHOTS_DIR;
test.skip(!DIR, "set TEXTUS_SHOTS_DIR to take the screenshots");

const record = (title: string, at: string) => ({
  created: at,
  updated: at,
  conversation: "c-1",
  title,
  document: "/novel/chapter-3.md",
});

const memory = (
  id: string,
  scope: "personal" | "project",
  kind: string,
  text: string,
  title: string,
) => ({
  id,
  scope,
  kind,
  text,
  file: `/x/${id}.md`,
  remembered: record(title, "2026-10-20T09:30:00Z"),
  included: true,
});

const COPY = {
  en: {
    ask: "Continue the scene. Lin barely talks - three or four words at a time. And I don't like dashes.",
    reply:
      "Continued with Lin answering in a few words, and no dashes in the new lines.",
    memories: [
      memory(
        "personal/memory/No-dashes",
        "personal",
        "preference",
        "Don't use dashes; use full stops or commas instead.",
        "Continue the scene",
      ),
      memory(
        "personal/memory/Reply-briefly",
        "personal",
        "preference",
        "Keep replies short.",
        "Is this email ok?",
      ),
      memory(
        "project/memory/Third-person",
        "project",
        "requirement",
        "Write this novel in the third person, past tense.",
        "Start chapter one",
      ),
    ],
    fact: {
      name: "Lin",
      body: "Cold, barely talks; three or four words at a time.",
    },
    forgot: "Never use semicolons.",
  },
  zh: {
    ask: "接着往下写一段。林晚这个人性子冷，不爱说话，开口也就三五个字。我不喜欢破折号。",
    reply: "续写里林晚只回短句，新写的部分没有用破折号。",
    memories: [
      memory(
        "personal/memory/No-dashes",
        "personal",
        "preference",
        "不用破折号，改用句号、逗号或调整句式。",
        "接着往下写",
      ),
      memory(
        "personal/memory/Reply-briefly",
        "personal",
        "preference",
        "回复要简短。",
        "这封邮件可以发吗",
      ),
      memory(
        "project/memory/Third-person",
        "project",
        "requirement",
        "这部小说用第三人称、过去时写。",
        "开始写第一章",
      ),
    ],
    fact: { name: "林晚", body: "性子冷，不爱说话，开口通常只有三五个字。" },
    forgot: "不要用分号。",
  },
};

for (const lang of ["en", "zh"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`memory ${lang} ${theme}`, async ({ page }) => {
      const copy = COPY[lang];
      await page.setViewportSize({ width: 1280, height: 860 });
      await page.emulateMedia({ colorScheme: theme });
      await openApp(page, {
        settings: {
          language: lang,
          theme: theme === "dark" ? "dark" : "light",
        },
        storage: { "textus-agent-panel-open": "1" },
      });
      const library = [
        {
          name: copy.fact.name,
          aliases: [],
          include: "mentioned",
          file: `.textus/library/${copy.fact.name}.md`,
          body: copy.fact.body,
          remembered: record(copy.ask.slice(0, 20), "2026-10-22T09:30:00Z"),
        },
      ];
      await mockInvoke(page, {
        load_agent_workspace: {
          instructions: [],
          project_instructions: "",
          skills: [],
          root: "/novel",
          style: null,
          library,
          memories: { items: copy.memories, chars: 120, cap: 4000 },
          remember: true,
        },
        library_use: {
          included: [],
          leftOut: [],
          lastRequest: false,
          cap: 8000,
        },
        ai_agent_message: [
          { kind: "User", text: copy.ask },
          { kind: "Assistant", text: copy.reply },
        ],
        memory_pass: [
          {
            remembered: `project/library/${copy.fact.name}`,
            scope: "project",
            created: true,
            text: copy.fact.body,
            previous: null,
            name: copy.fact.name,
          },
          {
            remembered: "personal/memory/No-dashes",
            scope: "personal",
            created: true,
            text: copy.memories[0].text,
            previous: null,
          },
          {
            remembered: "personal/memory/No-semicolons",
            scope: "personal",
            created: false,
            text: copy.forgot,
            previous: "---\nkind: requirement\n---\n" + copy.forgot,
            forgot: true,
          },
        ],
      });
      const composer = page.locator(".agent-panel-view textarea");
      await composer.fill(copy.ask);
      await composer.press("Enter");
      await expect(page.locator(".agent-memory-chip")).toHaveCount(3);
      await page.screenshot({ path: `${DIR}/chips-${lang}-${theme}.png` });
      await page.locator(".agent-panel-view").screenshot({
        path: `${DIR}/chips-panel-${lang}-${theme}.png`,
      });

      await page.locator("#agent-tab-memory").click();
      await expect(page.locator(".memory-remembered")).toBeVisible();
      await page.locator(".agent-panel-view").screenshot({
        path: `${DIR}/memory-tab-${lang}-${theme}.png`,
      });
    });
  }
}
