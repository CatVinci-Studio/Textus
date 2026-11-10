import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// A change Textus AI kept as a revision for a file it didn't have open
// (file-revisions.ts): opening the file shows it as revisions in the text,
// its tab counts them; a file edited since keeps the change apart, marked
// a conflict, never dropped.

const files = {
  "/notes/a.md": "# A\n\nOne.\n\nTwo.\n",
  "/notes/b.md": "# B\n\nMine now.\n",
};

const invoke = (page: Page, cmd: string, args: object) =>
  page.evaluate(
    ({ cmd, args }) =>
      (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (cmd: string, args: object) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__.invoke(cmd, args),
    { cmd, args },
  );

const keep = (page: Page, file: string, before: string, after: string) =>
  invoke(page, "kept_proposals_write", {
    docPath: `${file}#ai-changes`,
    workspaceRoot: null,
    kept: {
      version: 1,
      incoming: [{ ids: ["c1"], conversation: "x", before, after }],
    },
    pictures: [],
  });

const open = (page: Page, file: string) =>
  page.evaluate(
    (file) =>
      window.dispatchEvent(
        new CustomEvent("textus:open-file-in-tab", { detail: file }),
      ),
    file,
  );

test("a revision kept for a file not open shows in its text once it opens", async ({
  page,
}) => {
  await page.addInitScript((files) => {
    (window as unknown as { __devFiles: object }).__devFiles = files;
  }, files);
  await openApp(page);
  await keep(
    page,
    "/notes/a.md",
    files["/notes/a.md"],
    "# A\n\nOne!\n\nTwo.\n",
  );
  await open(page, "/notes/a.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor).toContainText("One");
  await expect(editor.locator('[data-call^="c1:"]').first()).toBeAttached();
  await expect(page.locator(".tab-pill-active .tab-pill-waiting")).toHaveText(
    "1",
  );
  // One bar for all that waits there.
  await expect(page.locator(".review-bar")).toHaveCount(1);
  // Placed: no longer waiting apart from the text.
  await expect
    .poll(() =>
      invoke(page, "kept_proposals_read", {
        docPath: "/notes/a.md#ai-changes",
        workspaceRoot: null,
      }),
    )
    .toBeNull();

  // Edited since the change found it: kept apart as a conflict.
  await keep(page, "/notes/b.md", "# B\n\nTheirs.\n", "# B\n\nOurs.\n");
  await open(page, "/notes/b.md");
  await expect(editor).toContainText("Mine now.");
  await expect
    .poll(async () => {
      const kept = (await invoke(page, "kept_proposals_read", {
        docPath: "/notes/b.md#ai-changes",
        workspaceRoot: null,
      })) as { incoming?: { conflict?: boolean }[] } | null;
      return kept?.incoming?.[0]?.conflict ?? false;
    })
    .toBe(true);
  await expect(editor.locator('[data-call^="c1:"]')).toHaveCount(0);
});
