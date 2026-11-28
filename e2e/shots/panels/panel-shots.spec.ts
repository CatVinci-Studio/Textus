/**
 * One screenshot of every panel and surface, light and dark, at desktop,
 * iPad and phone width: the "before" a UI change is compared against. Not a
 * test. A file is named <panel>__<theme>__<width>.png, so two runs diff by
 * name. The text is fixed (the English sample of the website's shots, a
 * fixed disk, a canned AI conversation): the same pictures every run.
 * Env: SHOTS_OUT (default test-results/panel-shots), TEXTUS_PLUGINS_DIR.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { emit, pasteMarkdown, PHONE, settled, TABLET } from "../../helpers";
import { canned, fileIn, launch, SAMPLES } from "../website/shot-kit";

const OUT = path.resolve(process.env.SHOTS_OUT ?? "test-results/panel-shots");

const WIDTHS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  ipad: TABLET,
  phone: PHONE,
};
const THEMES = ["light", "dark"] as const;

/** Every Settings page the desktop and the phone both have. */
const SETTINGS_PAGES = [
  "general",
  "look-basic",
  "edit-text",
  "edit-img",
  "edit-export",
  "providers",
  "chat",
  "memory",
  "extensions",
  "shortcuts",
  "privacy",
  "about",
];

/** What a device does not have, by design: Textus AI is off on iOS
 *  (capabilities.ts: hasTextusAi) and its settings pages go with it; the
 *  phone's Settings has no Shortcuts page and its sidebar no Plugins
 *  panel (they are under Settings > Extensions). */
const NOT_ON: Record<string, string[]> = {
  desktop: ["settings-list"],
  ipad: [
    "settings-list",
    "ai-panel",
    "review-margin",
    "settings-providers",
    "settings-chat",
    "settings-memory",
  ],
  phone: [
    "ai-panel",
    "review-margin",
    "settings-providers",
    "settings-chat",
    "settings-memory",
    "settings-shortcuts",
    "sidebar-plugins",
  ],
};

const s = SAMPLES.en as Required<(typeof SAMPLES)["en"]>;
const ROOT = `/Users/me/Documents/${s.folder}`;
const hero = { path: fileIn(s.folder, s.title), content: s.doc };
/** The folder on the dev shim's disk: the hero and the notes. */
const disk = Object.fromEntries([
  [hero.path, hero.content],
  ...Object.entries(s.notes).map(([title, text]) => [
    fileIn(s.folder, title),
    text,
  ]),
]);

/** Three installed themes with no screenshot, for the sample on their
 *  cards: Textus's own variables; a Typora theme with a dark design; and
 *  one that sets none of the values (it shows the look in use). */
const SAMPLE_THEMES = [
  { id: "own", name: "Own Variables", hasDark: false },
  { id: "typora", name: "Typora Style", hasDark: true },
  { id: "bare", name: "Sets Nothing", hasDark: false },
];
const THEME_SEED: Record<string, string> = {
  "own/light": `[data-content-theme="own"] { --doc-bg: #f6efe0; --doc-text: #3b2f22;
    --doc-accent: #b3401f; --doc-font: Georgia, "Times New Roman", serif; }`,
  "typora/light": `:root { --bg-color: #ffffff; --text-color: #333333; --primary-color: #0b6bcb; }
    body { background: var(--bg-color); color: var(--text-color); }
    #write a { color: var(--primary-color); }
    #write h1 { font-family: "Courier New", monospace; }`,
  "typora/dark": `:root { --bg-color: #1b2430; --text-color: #d7dee8; --primary-color: #6cb4ff; }
    body { background: var(--bg-color); color: var(--text-color); }
    #write a { color: var(--primary-color); }
    #write h1 { font-family: "Courier New", monospace; }`,
  "bare/light": `#write h3 { margin: 0; }`,
};

/** What a surface needs gone before the next one: menus, pickers, dialogs. */
async function clear(page: Page) {
  for (let i = 0; i < 3; i++) await page.keyboard.press("Escape");
}

for (const [width, device] of Object.entries(WIDTHS))
  for (const theme of THEMES)
    test.describe(`panel shots ${width} ${theme}`, () => {
      test.use(device);
      test.setTimeout(240_000);
      // A surface that cannot be reached fails in seconds, not at the test's end.
      test.use({ actionTimeout: 6000 });

      test("every surface", async ({ context }) => {
        const missed: string[] = [];
        const absent = NOT_ON[width];
        mkdirSync(OUT, { recursive: true });
        /** One fresh window on the fixed disk, so what an earlier surface
         *  opened or deleted cannot show in a later one. */
        const freshWindow = async (
          act: (
            surface: (name: string, act: () => Promise<void>) => Promise<void>,
            page: Page,
          ) => Promise<void>,
        ) => {
          const page = await context.newPage();
          const shoot = async (name: string) => {
            // No pointer resting on anything, no stray focus ring.
            await page.mouse.move(0, 0);
            await settled(page);
            await page.evaluate(() => document.fonts.ready);
            writeFileSync(
              path.join(OUT, `${name}__${theme}__${width}.png`),
              await page.screenshot(),
            );
          };
          /** One surface: a failure is noted and the rest still go. */
          const surface = async (name: string, act: () => Promise<void>) => {
            if (absent.includes(name)) return;
            try {
              await act();
              await shoot(name);
            } catch (error) {
              missed.push(
                `${name}: ${(error as Error).message.split("\n")[0]}`,
              );
            }
            await clear(page).catch(() => {});
          };
          await page.addInitScript((seed) => {
            (window as unknown as Record<string, unknown>).__devThemeSeed =
              seed;
          }, THEME_SEED);
          await page.addInitScript(
            ([root]) => {
              (window as unknown as Record<string, unknown>).__devPickFolder =
                root;
            },
            [ROOT],
          );
          await launch(page, {
            lang: "en",
            file: hero,
            project: { root: ROOT, library: s.library },
            plugins: { plugins: {}, folder: disk },
            settings: {
              theme,
              userThemes: SAMPLE_THEMES,
              addTabShowsStartPage: true,
              menuBarShown: false,
            },
            storage: { "textus-sidebar-open": "0" },
          });
          await page.addStyleTag({
            content: ".shots-traffic-lights{display:none}",
          });
          await page.emulateMedia({ colorScheme: theme });
          await expect(page.locator(".ProseMirror h1").first()).toBeVisible();
          await emit(page, "menu-open-folder");
          await act(surface, page);
          await page.close();
        };
        /** A sidebar panel: from the rail, or the menu event where the
         *  phone has no rail. */
        const panel = async (page: Page, label: string, event: string) => {
          const button = page
            .getByRole("navigation", { name: "Activity bar" })
            .getByRole("button", { name: label });
          if (await button.count()) await button.click();
          else await emit(page, event);
          await settled(page);
        };
        /** The sidebar out of the editor's way: a phone keeps it beside the text. */
        const closeSidebar = async (page: Page) => {
          const sidebar = page.locator(".sidebar");
          if (
            (await sidebar.count()) &&
            !(await sidebar.evaluate((el) =>
              el.classList.contains("sidebar-collapsed"),
            ))
          ) {
            await emit(page, "menu-toggle-sidebar");
            await settled(page);
          }
        };
        const settingsPage = async (page: Page, id: string) => {
          // Asked again until it takes: the first request can come before
          // a phone's sheet listens.
          await expect(async () => {
            await page.evaluate(
              (id) =>
                window.dispatchEvent(
                  new CustomEvent("textus:open-settings-page", {
                    detail: { page: id },
                  }),
                ),
              id,
            );
            await expect(
              // The tab's page, or on a phone the sheet's (its list, for
              // General).
              page
                .locator(
                  ".settings-tab-page > *, .settings-content, .settings-layout",
                )
                .first(),
            ).toBeVisible({ timeout: 1500 });
          }).toPass({ timeout: 8000 });
          // A phone's request for General lands on the list: open the row.
          if (width === "phone" && id === "general") {
            await page
              .locator(".settings-layout")
              .getByText("General", { exact: true })
              .click();
            await expect(page.locator(".settings-group").first()).toBeVisible();
          }
        };

        await freshWindow(async (surface, page) => {
          await surface("editor", async () => {});
          await surface("sidebar-files", () =>
            panel(page, "Files", "menu-toggle-sidebar"),
          );
          await surface("sidebar-outline", () =>
            panel(page, "Outline", "menu-toggle-outline"),
          );
          await surface("sidebar-search", () =>
            panel(page, "Search", "menu-find-in-files"),
          );
          await surface("sidebar-plugins", async () => {
            await emit(page, "menu-manage-plugins");
            await expect(
              page.locator(".plugins-panel-row").first(),
            ).toBeVisible();
          });
          await surface("palette", async () => {
            await emit(page, "menu-command-palette");
            await expect(
              page.locator(".quick-pick-item").first(),
            ).toBeVisible();
          });
          const contextMenu = async () => {
            await closeSidebar(page);
            await page
              .locator('[data-active-tab="true"] .ProseMirror p')
              .first()
              .click({ button: "right" });
            await expect(page.locator(".context-menu")).toBeVisible();
          };
          await surface("context-menu", contextMenu);
          // The row's own submenu, opened beside it.
          await surface("context-menu-submenu", async () => {
            await contextMenu();
            const group = page
              .locator(".context-menu")
              .getByRole("menuitem", { name: "Format" })
              .first();
            await group.hover();
            // Hover opens it beside the row; a phone's tap opens it in place.
            if ((await page.locator('[role="menu"]').count()) < 2)
              await group.click();
            await expect(page.locator('[role="menu"]')).toHaveCount(2);
          });
          // The unsaved-changes prompt, which asks the same everywhere.
          await surface("dialog", async () => {
            await closeSidebar(page);
            await pasteMarkdown(page, "# Unsaved words");
            await emit(page, "tauri://close-requested", null);
            await expect(page.getByRole("dialog")).toBeVisible();
          });
        });

        // Settings: each page, the theme gallery, a Select open.
        await freshWindow(async (surface, page) => {
          // A phone's page request opens its sheet; the others need the tab.
          if (width !== "phone") await emit(page, "menu-settings");
          for (const id of SETTINGS_PAGES)
            await surface(`settings-${id}`, () => settingsPage(page, id));
          await surface("settings-theme-gallery", async () => {
            await settingsPage(page, "look-basic");
            await page
              .locator(".theme-gallery-item")
              .first()
              .scrollIntoViewIfNeeded();
            await expect(
              page.locator(".theme-gallery-preview").first(),
            ).toBeVisible();
          });
          await surface("select-open", async () => {
            await settingsPage(page, "general");
            await page.locator(".ui-select").first().click();
            // A phone's Select is the app's menu (Select.tsx), the others' a list.
            await expect(
              page
                .getByRole(width === "phone" ? "menuitemradio" : "option")
                .first(),
            ).toBeVisible();
          });
        });

        // A phone's Settings opens on the list of pages; the other widths
        // show the list beside the page, which the pages' shots have.
        await freshWindow(async (surface, page) => {
          await emit(page, "menu-settings");
          await surface("settings-list", async () => {
            await expect(page.locator(".settings-layout")).toBeVisible();
          });
        });

        await freshWindow(async (surface, page) => {
          await surface("start-page", async () => {
            await page.locator(".tab-bar-add").first().click();
            await expect(page.locator(".start-page")).toBeVisible();
          });
        });

        // The AI's proposal and comment, in its panel and in the margin.
        await freshWindow(async (surface, page) => {
          // The window bar's button, or the menu's item where a phone has none.
          const button = page.getByRole("button", { name: "Textus AI" });
          if (await button.count()) await button.first().click();
          else await emit(page, "menu-toggle-agent-panel");
          await canned(page, {
            ai_agent_message: [
              { kind: "User", text: s.ask },
              {
                kind: "ToolCall",
                call_id: "e1",
                name: "propose_edit",
                arguments: JSON.stringify({
                  action: "replace",
                  anchor: s.anchor,
                  text: s.edited,
                  reason: s.reason,
                }),
              },
              { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
              {
                kind: "ToolCall",
                call_id: "c1",
                name: "add_comment",
                arguments: JSON.stringify({
                  anchor: s.commentAnchor,
                  comment: s.comment,
                }),
              },
              { kind: "ToolResult", call_id: "c1", output: "Comment added" },
              { kind: "Assistant", text: s.reply },
            ],
          });
          await surface("ai-panel", async () => {
            const composer = page.locator(".agent-panel-view textarea");
            await composer.fill(s.ask);
            await composer.press("Enter");
            await expect(page.locator(".agent-proposal-reason")).toHaveText(
              s.reason,
            );
            await composer.blur();
          });
          await surface("review-margin", async () => {
            await page.locator(".tab-pill", { hasText: s.title }).click();
            await expect(
              page.locator(".milkdown .pending-sentence").first(),
            ).toBeVisible();
          });
        });

        // Report what was not reached, after the rest went.
        expect(missed, "surfaces not reached").toEqual([]);
      });
    });
