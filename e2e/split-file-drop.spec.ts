import { expect, test, type Page } from "@playwright/test";
import { emit, openApp } from "./helpers";

/*
 * A note dragged from the sidebar onto a window split in two: on its way
 * in it crosses the documents' outer edge, which splits off a third island
 * only once the pointer has been on a document.
 */

async function splitWindow(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = {
      "/w/left.md": "# Left\n\n" + "Words on the left. ".repeat(40),
      "/w/right.md": "# Right\n\n" + "Words on the right. ".repeat(40),
      "/w/third.md": "# Third\n",
    };
    w.__devPickFolder = "/w";
  });
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-folder");
  await page.locator(".tree-row", { hasText: "left.md" }).dblclick();
  // right.md split off beside it, by the documents' right edge.
  const island = (await page.locator("section.island").boundingBox())!;
  await dragRow(page, "right.md", [
    { x: island.x + island.width / 2, y: island.y + island.height / 2 },
    { x: island.x + island.width - 12, y: island.y + island.height / 2 },
  ]);
  await page.mouse.up();
  await expect(page.locator("section.island")).toHaveCount(2);
}

async function dragRow(
  page: Page,
  name: string,
  path: { x: number; y: number }[],
) {
  const row = (await page
    .locator(".tree-row", { hasText: name })
    .boundingBox())!;
  await page.mouse.move(row.x + 20, row.y + row.height / 2);
  await page.mouse.down();
  for (const to of path) await page.mouse.move(to.x, to.y, { steps: 8 });
}

/** Every width each document's text takes from now on. */
async function watchWidths(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __widths: number[][] };
    const docs = [...document.querySelectorAll(".ProseMirror")];
    w.__widths = docs.map(() => []);
    const observer = new ResizeObserver(() =>
      docs.forEach((d, i) => w.__widths[i]!.push(Math.round(d.clientWidth))),
    );
    docs.forEach((d) => observer.observe(d));
  });
}

test("a note dragged in across the outer edge to an island's body leaves both islands as they are, its tab room at the row's end", async ({
  page,
}) => {
  await splitWindow(page);
  const islands = page.locator("section.island");
  const left = (await islands.first().boundingBox())!;
  await watchWidths(page);
  const before = await page.evaluate(() =>
    [...document.querySelectorAll(".ProseMirror")].map((d) =>
      Math.round(d.clientWidth),
    ),
  );
  // Straight in from the sidebar, at the height of the text.
  const y = left.y + left.height / 2;
  await dragRow(page, "third.md", [
    { x: left.x - 30, y },
    { x: left.x + left.width / 2, y },
  ]);
  const room = page.locator(".tab-pill-preview");
  await expect(room).toBeVisible();
  // The room stands after the island's own tab, not before it.
  const own = (await page
    .locator('[role="tab"]', { hasText: "left" })
    .boundingBox())!;
  expect((await room.boundingBox())!.x).toBeGreaterThan(own.x);
  // The row's + moves on past the room instead of going under it.
  const add = page.locator(".tab-bar-add").first();
  await expect
    .poll(async () => {
      const r = (await room.boundingBox())!;
      return (await add.boundingBox())!.x >= r.x + r.width;
    })
    .toBe(true);
  // Neither document's text changed width on the way.
  const widths = await page.evaluate(
    () => (window as unknown as { __widths: number[][] }).__widths,
  );
  widths.forEach((seen, i) =>
    expect(new Set([before[i], ...seen])).toEqual(new Set([before[i]])),
  );
  await page.mouse.up();
  await expect(islands).toHaveCount(2);
  await expect(
    page.locator('[role="tab"]', { hasText: "third" }),
  ).toBeVisible();
});

test("into an island and back out to the outer edge, a note splits off there", async ({
  page,
}) => {
  await splitWindow(page);
  const left = (await page.locator("section.island").first().boundingBox())!;
  const y = left.y + left.height / 2;
  await dragRow(page, "third.md", [
    { x: left.x - 30, y },
    { x: left.x + left.width / 2, y },
    { x: left.x + 8, y },
  ]);
  await page.mouse.up();
  await expect(page.locator("section.island")).toHaveCount(3);
});
