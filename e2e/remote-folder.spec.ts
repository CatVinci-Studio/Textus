import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * A folder a plugin provides (files.registerProvider) - here kept in the
 * page's memory, as the provider layer hands it to the window - opened,
 * edited, renamed and searched like one on disk, with none of its paths
 * reaching the backend's file commands.
 */

async function openMemoryFolder(page: Page, files: Record<string, string>) {
  await page.evaluate(async (start) => {
    const w = window as unknown as Record<string, unknown>;
    const disk = new Map<string, string | null>(Object.entries(start));
    w.__memDisk = disk;
    // Every backend call carrying a remote path, which it would take for a
    // relative one.
    const internals = w.__TAURI_INTERNALS__ as {
      invoke: (cmd: string, args?: unknown) => Promise<unknown>;
    };
    const invoke = internals.invoke;
    const leaks: string[] = [];
    w.__memLeaks = leaks;
    internals.invoke = (cmd, args) => {
      if (JSON.stringify(args ?? null).includes("mem://")) leaks.push(cmd);
      return invoke(cmd, args);
    };
    const parent = (url: string) => url.slice(0, url.lastIndexOf("/"));
    const name = (url: string) => url.slice(url.lastIndexOf("/") + 1);
    const path = "/src/platform/far-files.ts";
    const far = await import(/* @vite-ignore */ path);
    far.setFarProvider("mem", {
      listFolder: async (url: string) =>
        [...disk]
          .filter(([p]) => parent(p) === url)
          .map(([p, text]) => ({
            name: name(p),
            path: p,
            is_dir: text === null,
            hidden: false,
            ignored: false,
          })),
      readText: async (url: string) => disk.get(url) ?? "",
      readBase64: async (url: string) => btoa(disk.get(url) ?? ""),
      writeText: async (url: string, text: string) => {
        disk.set(url, text);
      },
      createEntry: async (dir: string, entry: string, folder: boolean) => {
        disk.set(`${dir}/${entry}`, folder ? null : "");
        return `${dir}/${entry}`;
      },
      renameEntry: async (url: string, to: string) => {
        const next = `${parent(url)}/${to}`;
        disk.set(next, disk.get(url) ?? null);
        disk.delete(url);
        return next;
      },
      moveEntry: async (url: string, _from: string, into: string) => {
        const next = `${into}/${name(url)}`;
        disk.set(next, disk.get(url) ?? null);
        disk.delete(url);
        return next;
      },
      deleteEntry: async (url: string) => disk.delete(url),
    });
    window.dispatchEvent(
      new CustomEvent("textus:open-folder", { detail: "mem://box/notes" }),
    );
  }, files);
}

const disk = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      (window as unknown as { __memDisk: Map<string, string | null> })
        .__memDisk,
    ),
  );

test("a remote folder opens in the sidebar, its documents edited, renamed and searched there", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await openMemoryFolder(page, {
    "mem://box/notes/plan.md": "# Plan\n\nThe road north.\n",
    "mem://box/notes/drafts": null as unknown as string,
    "mem://box/notes/drafts/idea.md": "An idea\n",
  });
  const row = page.locator('.tree-row[data-path="mem://box/notes/plan.md"]');
  await row.dblclick();
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor).toContainText("The road north.");
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Then west.");
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(async () => (await disk(page))["mem://box/notes/plan.md"])
    .toContain("The road north. Then west.");
  // Renamed in the sidebar: the file moves there, its tab with it.
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Rename/ }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("route.md");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => Object.keys(await disk(page)))
    .toContain("mem://box/notes/route.md");
  await expect(page.locator(".tab-pill").last()).toContainText("route.md");
  // Searched from the sidebar: the line found in the remote document.
  await page.locator('[data-rail-id="search"]').click();
  await page.locator(".search-panel input").fill("west");
  await expect(page.locator(".search-text-file")).toContainText("route.md");
  // Its paths reached the backend only as names kept in the app's own data
  // (recents, the session, notes, undo), never as files to read or write.
  const KEYED = [
    "add_recent_file",
    "add_recent_folder",
    "update_window_session",
    "document_data_move",
    "kept_proposals_read",
    "own_notes_read",
    "undo_file_load",
  ];
  const leaks = await page.evaluate(
    () => (window as unknown as { __memLeaks: string[] }).__memLeaks,
  );
  expect(leaks.filter((cmd) => !KEYED.includes(cmd))).toEqual([]);
});
