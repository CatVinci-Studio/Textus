import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * Plugins' scheduled jobs, notifications, background code and app state
 * (API 1.1), against the dev shim's stand-in for Rust's scheduler
 * (src/dev/schedule-shim.ts): a test fires a job as the timer would.
 */

const HOST = `
exports.activate = function (ctx) {
  textus.commands.register("test.remind.set", async function () {
    await textus.schedule.set("morning", {
      daily: "09:00",
      notify: {
        title: "Write",
        body: "Your morning page",
        open: { path: "/work/notes/b.md", line: 2 },
      },
    });
    await textus.schedule.set("hourly", { every: "1h", run: "tick" });
    const jobs = await textus.schedule.list();
    textus.ui.notice("jobs " + jobs.map((j) => j.id).sort().join(","));
  });
  textus.app.onDidChangeState(function (state) {
    textus.ui.notice("now " + state + " / " + textus.app.state);
  });
};
`;

const BACKGROUND = `
exports.tick = async function (job, ctx) {
  await ctx.storage.global.set("ticked", job.id);
  await textus.notify.show({ title: "tick " + job.id + " " + textus.app.state });
  try {
    textus.editor.getText();
  } catch (err) {
    await textus.notify.show({ title: err.message });
  }
};
`;

const PLUGIN = {
  id: "test.remind",
  dir: "/plugins/test.remind",
  manifest: JSON.stringify({
    id: "test.remind",
    name: "Remind",
    version: "1.0.0",
    publisher: "test",
    engines: { textus: "^1.3.0" },
    main: "host.js",
    background: "background.js",
    activationEvents: ["onStartupFinished"],
    permissions: ["notifications", "background", "files.read"],
    contributes: {
      commands: [{ command: "test.remind.set", title: "Set" }],
    },
  }),
  dev: false,
  files: { "host.js": HOST, "background.js": BACKGROUND },
};

type Shim = {
  __devEmitTauriEvent: (n: string, p?: unknown) => void;
  __devSchedule: {
    notifications: { plugin: string; title: string; body?: string }[];
    fire(plugin: string, id: string): void;
    click(index: number): void;
    setAppState(state: string): void;
  };
};

async function open(page: Page, granted: string[]) {
  await page.addInitScript(
    ({ entry, granted }) => {
      if (window.top !== window) return;
      const w = window as unknown as Record<string, unknown>;
      w.__devPlugins = [entry];
      w.__devPluginState = {
        allOn: true,
        plugins: { [entry.id]: { enabled: true, granted } },
      };
      w.__devFs = {
        "/work/notes/a.md": "# A\n",
        "/work/notes/b.md": "# B\n\nfirst\n\nthird line\n",
      };
    },
    { entry: PLUGIN, granted },
  );
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() =>
    (window as unknown as Shim).__devEmitTauriEvent(
      "menu-open-recent",
      "/work/notes/a.md",
    ),
  );
  await expect(page.locator('[data-active-tab="true"] h1')).toContainText("A");
}

/** Runs the plugin's command that sets its jobs, once it has loaded. */
async function setJobs(page: Page, timeout = 10_000) {
  await expect(async () => {
    await page.evaluate(() =>
      (window as unknown as Shim).__devEmitTauriEvent(
        "menu-plugin-command",
        "test.remind.set",
      ),
    );
    await expect(page.getByText("jobs hourly,morning").first()).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout });
}

const notifications = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Shim).__devSchedule.notifications.map((n) => n.title),
  );

test("a daily reminder fires as a notification whose click opens its file", async ({
  page,
}) => {
  await open(page, ["notifications", "background", "files.read"]);
  await setJobs(page);
  await page.evaluate(() =>
    (window as unknown as Shim).__devSchedule.fire("test.remind", "morning"),
  );
  expect(await notifications(page)).toEqual(["Write"]);
  await page.evaluate(() => (window as unknown as Shim).__devSchedule.click(0));
  await expect(page.locator('[data-active-tab="true"] h1')).toContainText("B");
});

test("the first job with background mode off says so once, with a way to turn it on", async ({
  page,
}) => {
  await open(page, ["notifications", "background", "files.read"]);
  await setJobs(page);
  const notice = page.getByText(
    "Remind scheduled something. It only runs while Textus is running",
    { exact: false },
  );
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}")
            .runInBackground,
      ),
    )
    .toBe(true);
});

test("a job's run calls the background code, which has no editor", async ({
  page,
}) => {
  await open(page, ["notifications", "background", "files.read"]);
  await setJobs(page);
  await page.evaluate(() =>
    (window as unknown as Shim).__devSchedule.fire("test.remind", "hourly"),
  );
  await expect
    .poll(() => notifications(page))
    .toEqual([
      "tick hourly active",
      "textus.editor is not available in background code.",
    ]);
});

test("a plugin without the grants schedules nothing", async ({ page }) => {
  await open(page, ["files.read"]);
  await expect(setJobs(page, 4_000)).rejects.toThrow();
  expect(
    await page.evaluate(() => [
      ...(window as unknown as Shim).__devSchedule.notifications,
    ]),
  ).toEqual([]);
});

test("a plugin hears Textus go behind and come back", async ({ page }) => {
  await open(page, ["notifications", "background", "files.read"]);
  await page.evaluate(() =>
    (window as unknown as Shim).__devSchedule.setAppState("inactive"),
  );
  await expect(page.getByText("now inactive / inactive")).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as Shim).__devSchedule.setAppState("active"),
  );
  await expect(page.getByText("now active / active")).toBeVisible();
});
