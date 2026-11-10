import { expect, test, type Page } from "@playwright/test";
import { emit, openApp, settled } from "./helpers";
import { markEach, recordFrames } from "./frames/record";
import {
  aligned,
  firstShownShare,
  maxStep,
  sameWidth,
  steadyGap,
  worst,
  type Frame,
  type Miss,
} from "./frames/claims";

// The window's layout held to its motion frame by frame: every island's row
// stays on its sheet while they move, a new island grows from nothing as
// its neighbour gives way, and a tab never changes width under the pointer.
// Stopwatch flows (@perf): a busy machine drops frames.

const AREA = ".main-pane";
const NEW_SHEET = "section.island:not([data-frame-mark])";
const NEW_ROW = ".island-row:not([data-frame-mark])";

async function open(page: Page) {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false }, animations: true });
  await settled(page);
}

const aiButton = (page: Page) =>
  page.getByRole("button", { name: "Textus AI" }).first();

/** The islands on screen now, named sheet0, row0, sheet1… for a recording. */
async function islandsNow(page: Page) {
  return {
    ...(await markEach(page, "section.island", "sheet")),
    ...(await markEach(page, ".island-row", "row")),
  };
}

/** A claim's misses as one line: how many frames, the worst and when. */
function told(misses: Miss[]): string {
  const most = worst(misses);
  return most
    ? `${misses.length} frames off, worst ${most.by}px at ${Math.round(most.t)}ms${most.name ? ` (${most.name})` : ""}`
    : "none";
}

/** Each claim's measure, in the run's output: what a failing run quotes. */
function report(name: string, measured: Record<string, unknown>) {
  console.log(`[frames] ${name}: ${JSON.stringify(measured)}`);
}

/** A row stays on its sheet: their sides level in every frame. */
function rowOnSheet(frames: Frame[], sheet: string, row: string) {
  // Laid out at its end width, a shrinking island's row may end short of
  // its sheet mid-slide; it never shows past it.
  const past = frames.flatMap((frame, i) => {
    const s = frame.boxes[sheet];
    const r = frame.boxes[row];
    if (!s || !r) return [];
    const by = r.left + r.shownWidth - s.right;
    return by > 1
      ? [{ frame: i, t: frame.t, by: Math.round(by * 100) / 100 }]
      : [];
  });
  return [...aligned(frames, sheet, row, "left"), ...past];
}

/** The gap a new island opens beside its neighbour as it grows: from
 *  nothing to the layout's gap, never more. */
const GAP_OPENS = 10;

/** Still in the page at the end: a block rebuilt mid-motion would pass
 *  every claim about it by being absent. */
function kept(frames: Frame[], ...names: string[]) {
  for (const name of names)
    expect(frames[frames.length - 1]?.boxes[name], `${name} kept`).toBeTruthy();
}

/**
 * A new island opens at the right of the one there: it and its row grow
 * from nothing, held at the area's right; the old island gives way in the
 * same frames, the gap between them opening no wider than the layout's;
 * each row on its sheet.
 */
function expectIslandGrewIn(name: string, frames: Frame[]) {
  kept(frames, "sheet0", "row0", "added", "addedRow");
  const first = {
    sheet: firstShownShare(frames, "added"),
    row: firstShownShare(frames, "addedRow"),
  };
  const between = steadyGap(
    frames,
    ["sheet0", "right"],
    ["added", "left"],
    GAP_OPENS,
  );
  const atRight = steadyGap(frames, ["added", "right"], ["area", "right"]);
  const oldRow = rowOnSheet(frames, "sheet0", "row0");
  const newRow = rowOnSheet(frames, "added", "addedRow");
  const start = frames[0]!.boxes.sheet0!;
  const end = frames[frames.length - 1]!.boxes.sheet0!;
  const travel = Math.abs(start.right - end.right);
  const step = maxStep(frames, "sheet0");
  report(name, {
    frames: frames.length,
    firstShownShare: first,
    gapBetween: told(between),
    newHeldAtRight: told(atRight),
    oldRowOnSheet: told(oldRow),
    newRowOnSheet: told(newRow),
    oldTravel: Math.round(travel),
    oldMaxStep: step,
  });
  expect
    .soft(first.sheet, "the new sheet starts from nothing")
    .toBeLessThan(0.25);
  expect.soft(first.row, "the new row starts from nothing").toBeLessThan(0.25);
  expect
    .soft(told(between), "the old island gives way in the same frames")
    .toBe("none");
  expect.soft(told(atRight), "the new island stays at the right").toBe("none");
  expect.soft(told(oldRow), "the old row stays on its sheet").toBe("none");
  expect.soft(told(newRow), "the new row stays on its sheet").toBe("none");
  expect.soft(travel, "the old island shrinks").toBeGreaterThan(100);
  expect.soft(step, "the old island never jumps").toBeLessThan(travel * 0.4);
}

test("opening the AI from a document, its island grows from nothing as the document's gives way @perf", async ({
  page,
}) => {
  await open(page);
  const frames = await recordFrames(
    page,
    {
      ...(await islandsNow(page)),
      area: AREA,
      added: NEW_SHEET,
      addedRow: NEW_ROW,
    },
    () => aiButton(page).click(),
  );
  expectIslandGrewIn("a. AI from a document", frames);
});

test("opening the AI with only Settings open, its island grows from nothing as Settings' gives way @perf", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-open-settings");
  const doc = page.locator(".tab-pill").filter({ hasText: "未命名" });
  await doc.click();
  await doc.locator(".tab-pill-close").click();
  await expect(page.locator(".tab-pill")).toHaveText(["设置"]);
  await settled(page);
  const frames = await recordFrames(
    page,
    {
      ...(await islandsNow(page)),
      area: AREA,
      added: NEW_SHEET,
      addedRow: NEW_ROW,
    },
    () => aiButton(page).click(),
  );
  expectIslandGrewIn("b. AI from Settings alone", frames);
});

test("toggling the sidebar, the first island slides over and its row stays on it @perf", async ({
  page,
}) => {
  await open(page);
  const targets = await islandsNow(page);
  for (const turn of ["first", "second"]) {
    const frames = await recordFrames(page, targets, () =>
      emit(page, "menu-toggle-sidebar"),
    );
    kept(frames, "sheet0", "row0");
    const row = rowOnSheet(frames, "sheet0", "row0");
    const travel = Math.abs(
      frames[0]!.boxes.sheet0!.left -
        frames[frames.length - 1]!.boxes.sheet0!.left,
    );
    const step = maxStep(frames, "sheet0");
    report(`c. sidebar, ${turn} toggle`, {
      frames: frames.length,
      sheetTravel: Math.round(travel),
      rowOnSheet: told(row),
      sheetMaxStep: step,
    });
    expect.soft(travel, "the island moves over").toBeGreaterThan(100);
    expect.soft(step, "it never jumps").toBeLessThan(travel * 0.4);
    expect.soft(told(row), "the row stays on its sheet").toBe("none");
    await settled(page);
  }
});

test("splitting right, the new island grows from nothing as the old one gives way @perf", async ({
  page,
}) => {
  await open(page);
  const frames = await recordFrames(
    page,
    {
      ...(await islandsNow(page)),
      area: AREA,
      added: NEW_SHEET,
      addedRow: NEW_ROW,
    },
    () => emit(page, "menu-split-right"),
  );
  expectIslandGrewIn("d. split right", frames);
});

/** Three tabs in one row, the last in front, named tab0…tab2. */
async function threeTabs(page: Page) {
  await open(page);
  await emit(page, "menu-new-file");
  await emit(page, "menu-new-file");
  await expect(page.locator(".tab-pill")).toHaveCount(3);
  await settled(page);
  return markEach(page, ".tab-pill", "tab");
}

test("closing the last of three tabs, the other two keep their widths @perf", async ({
  page,
}) => {
  const tabs = await threeTabs(page);
  const frames = await recordFrames(page, tabs, () =>
    page.locator(".tab-pill").last().locator(".tab-pill-close").click(),
  );
  kept(frames, "tab0", "tab1");
  const resized = sameWidth(frames, ["tab0", "tab1"]);
  report("e. closing the last of three tabs", {
    frames: frames.length,
    resized: told(resized),
  });
  expect(told(resized), "no tab left changes width").toBe("none");
});

test("switching tabs back and forth, no tab changes width @perf", async ({
  page,
}) => {
  const tabs = await threeTabs(page);
  const frames = await recordFrames(
    page,
    tabs,
    async () => {
      for (const at of [0, 2, 1, 2]) {
        await page.locator(".tab-pill").nth(at).click();
        await page.waitForTimeout(250);
      }
    },
    400,
  );
  kept(frames, "tab0", "tab1", "tab2");
  const resized = sameWidth(frames, ["tab0", "tab1", "tab2"]);
  report("f. switching tabs", {
    frames: frames.length,
    resized: told(resized),
  });
  expect(told(resized), "no tab changes width").toBe("none");
});

test("resizing the window from 1200 to 900 wide, every row stays on its sheet @perf", async ({
  page,
}) => {
  await open(page);
  await aiButton(page).click();
  await expect(page.locator("section.island")).toHaveCount(2);
  await settled(page);
  const frames = await recordFrames(page, await islandsNow(page), () =>
    page.setViewportSize({ width: 900, height: 760 }),
  );
  kept(frames, "sheet0", "row0", "sheet1", "row1");
  const rows = [
    ...rowOnSheet(frames, "sheet0", "row0"),
    ...rowOnSheet(frames, "sheet1", "row1"),
  ];
  const between = steadyGap(frames, ["sheet0", "right"], ["sheet1", "left"]);
  report("g. window 1200 to 900", {
    frames: frames.length,
    rowsOnSheets: told(rows),
    gapBetween: told(between),
  });
  expect.soft(told(rows), "each row stays on its sheet").toBe("none");
  expect.soft(told(between), "the islands keep their gap").toBe("none");
});
