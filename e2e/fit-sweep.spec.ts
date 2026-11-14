import { expect, test, type Page } from "@playwright/test";
import { emit, openApp } from "./helpers";

// Every Settings page at every island width it can be given, in the
// longest languages: nothing past the island's edge, no two controls on
// top of each other, and a control wrapped under its name starts where the
// name does.

const PAGES = [
  "general",
  "look-basic",
  "edit-text",
  "edit-img",
  "edit-export",
  "providers",
  "chat",
  "memory",
  "mcp",
  "shortcuts",
  "privacy",
  "about",
];
/** Panel widths asked for; the narrowest is held at the content's least. */
const WIDTHS = [150, 320, 400, 480, 640];

async function problems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const island = document
      .querySelector(".settings-tab")!
      .closest<HTMLElement>("[data-pane-id]")!;
    const edge = island.getBoundingClientRect();
    const root = document.querySelector<HTMLElement>(".settings-tab-page")!;
    // Drawn and not cut away by a folded or scrolled box around it.
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      if (getComputedStyle(el).visibility === "hidden") return false;
      const fold = el.closest("details:not([open])");
      if (fold && !el.closest("summary")) return false;
      for (
        let up = el.parentElement;
        up && up !== root;
        up = up.parentElement
      ) {
        if (getComputedStyle(up).overflow === "visible") continue;
        const box = up.getBoundingClientRect();
        if (r.bottom <= box.top + 1 || r.top >= box.bottom - 1) return false;
      }
      return true;
    };
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} "${(el.textContent ?? "").trim().slice(0, 24)}"`;
    for (const el of root.querySelectorAll("*")) {
      if (!shown(el) || el.closest("[hidden], .info-tip-description")) continue;
      const r = el.getBoundingClientRect();
      if (r.right > edge.right + 1 || r.left < edge.left - 1)
        out.push(`past the edge: ${name(el)}`);
    }
    const controls = [
      ...root.querySelectorAll<HTMLElement>(
        "button, select, input:not([type=hidden]), [role=switch], .tx-segmented",
      ),
    ].filter((el) => shown(el) && !el.closest(".tx-segmented button"));
    controls.forEach((a, i) => {
      const ra = a.getBoundingClientRect();
      for (const b of controls.slice(i + 1)) {
        if (a.contains(b) || b.contains(a)) continue;
        const rb = b.getBoundingClientRect();
        const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (x > 2 && y > 2) out.push(`overlap: ${name(a)} / ${name(b)}`);
      }
    });
    for (const row of root.querySelectorAll<HTMLElement>(".settings-row")) {
      const [first, last] = [row.firstElementChild, row.lastElementChild];
      if (!first || !last || first === last || !shown(last)) continue;
      const a = first.getBoundingClientRect();
      const b = last.getBoundingClientRect();
      if (b.top >= a.bottom - 1 && Math.abs(b.left - a.left) > 2)
        out.push(`wrapped, not aligned: ${name(row)}`);
    }
    return [...new Set(out)];
  });
}

for (const language of ["zh", "en", "de"])
  test(`Settings fits every width in ${language}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1400, height: 900 });
    const found: string[] = [];
    for (const width of WIDTHS) {
      await openApp(page, {
        settings: { language, menuBarShown: false },
        storage: { "textus-panel-px": String(width) },
      });
      await emit(page, "menu-settings");
      await emit(page, "menu-split-right");
      await page.locator(".settings-tab").waitFor();
      for (const id of PAGES) {
        await page.evaluate(
          (p) =>
            window.dispatchEvent(
              new CustomEvent("textus:open-settings-page", {
                detail: { page: p },
              }),
            ),
          id,
        );
        await page.waitForTimeout(150);
        for (const p of await problems(page))
          found.push(`${width} ${id}: ${p}`);
      }
    }
    expect(found).toEqual([]);
  });

// The window's own parts - its bar, tab rows, rail and sidebar heads -
// across the states it can be in: nothing drawn on top of anything else.
// One page per platform, the states switched in it, so it stays quick.
async function chromeOverlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const roots = document.querySelectorAll(
      ".window-bar, .tab-bar, .activity-rail, .sidebar-header, .island-head, .sidebar-tabs",
    );
    // The part of `el` that is drawn: its box cut by every box around it
    // that clips (a scrolled tab row), or null when nothing of it shows.
    const drawn = (el: Element) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.opacity === "0") return null;
      let [left, top, right, bottom] = [r.left, r.top, r.right, r.bottom];
      for (let up = el.parentElement; up; up = up.parentElement) {
        const s = getComputedStyle(up);
        if (s.opacity === "0") return null;
        if (s.overflow === "visible" && s.clipPath === "none") continue;
        const box = up.getBoundingClientRect();
        left = Math.max(left, box.left);
        top = Math.max(top, box.top);
        right = Math.min(right, box.right);
        bottom = Math.min(bottom, box.bottom);
      }
      return right - left > 4 && bottom - top > 4
        ? { left, top, right, bottom }
        : null;
    };
    // What is drawn: controls, and any element with words of its own.
    const parts: { el: Element; r: NonNullable<ReturnType<typeof drawn>> }[] =
      [];
    const seen = new Set<Element>();
    for (const root of roots)
      for (const el of root.querySelectorAll("*")) {
        if (seen.has(el) || el.closest("svg *")) continue;
        seen.add(el);
        const own = [...el.childNodes].some(
          (n) => n.nodeType === 3 && n.textContent!.trim(),
        );
        if (!own && !el.matches("button, input, select, [role=tab], svg"))
          continue;
        const r = drawn(el);
        if (r) parts.push({ el, r });
      }
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}.${String((el.className as unknown as SVGAnimatedString).baseVal ?? el.className).split(" ")[0]} "${(el.textContent ?? "").trim().slice(0, 16)}"`;
    const out: string[] = [];
    // A long tab row scrolls its tabs under its + and list, held at its end
    // on the row's own colour: that cover is meant.
    const held = (el: Element) =>
      !!el.closest(".tab-bar-add, .tab-bar-list") &&
      !!el.closest(".tab-bar[data-overflow]");
    parts.forEach((a, i) => {
      for (const b of parts.slice(i + 1)) {
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const tabs = (e: Element) => !!e.closest(".tab-strip");
        if ((held(a.el) && tabs(b.el)) || (held(b.el) && tabs(a.el))) continue;
        const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (x > 4 && y > 4) out.push(`${name(a.el)} / ${name(b.el)}`);
      }
    });
    // Each row shows its open tab whole, clear of what is held over it.
    for (const bar of document.querySelectorAll(".tab-bar")) {
      const open = bar.querySelector(".tab-pill-active");
      if (!open) continue;
      const r = open.getBoundingClientRect();
      const box = bar.getBoundingClientRect();
      const cover = [...bar.querySelectorAll(".tab-bar-add, .tab-bar-list")]
        .filter(() => bar.hasAttribute("data-overflow"))
        .map((e) => e.getBoundingClientRect().left);
      const end = Math.min(box.right, ...cover);
      if (r.left < box.left - 1 || r.right > end + 1)
        out.push(`open tab not whole: ${name(open)}`);
    }
    return [...new Set(out)];
  });
}

const STATES = [
  { activityRail: true, menuBarShown: false },
  { activityRail: false, menuBarShown: false },
  { activityRail: true, menuBarShown: true },
  { activityRail: false, menuBarShown: true },
];

for (const [os, platform] of [
  ["mac", "MacIntel"],
  ["windows", "Win32"],
  ["linux", "Linux x86_64"],
] as const)
  test(`the window's parts never overlap on ${os}`, async ({ page }) => {
    test.setTimeout(60_000);
    // The user agent too: Playwright's says Windows, and the platform
    // check reads it.
    await page.addInitScript((p) => {
      Object.defineProperty(navigator, "platform", { get: () => p });
      Object.defineProperty(navigator, "userAgent", {
        get: () => `Mozilla/5.0 (${p}) AppleWebKit/537.36 Chrome/157.0`,
      });
    }, platform);
    await page.setViewportSize({ width: 1200, height: 760 });
    await openApp(page, { settings: { language: "de" } });
    await emit(page, "menu-settings");
    await emit(page, "menu-split-right");
    const found: string[] = [];
    for (const state of STATES)
      for (const uiTextScale of [1, 1.25])
        for (const width of [760, 1200]) {
          await page.setViewportSize({ width, height: 760 });
          await page.evaluate(
            (patch) => {
              const key = "catvinci-settings";
              const next = JSON.stringify({
                ...JSON.parse(localStorage.getItem(key) ?? "{}"),
                ...patch,
              });
              localStorage.setItem(key, next);
              window.dispatchEvent(
                new StorageEvent("storage", { key, newValue: next }),
              );
            },
            { ...state, uiTextScale },
          );
          for (const sidebar of [false, true]) {
            const open = await page.locator(".sidebar-header").count();
            if (!!open !== sidebar) await emit(page, "menu-toggle-sidebar");
            await page.waitForTimeout(120);
            const said = JSON.stringify({
              ...state,
              uiTextScale,
              width,
              sidebar,
            });
            // Only what stays: under load the layout may still be settling.
            let left = await chromeOverlaps(page);
            for (let i = 0; left.length && i < 10; i++) {
              await page.waitForTimeout(150);
              left = await chromeOverlaps(page);
            }
            for (const p of left) found.push(`${said}: ${p}`);
          }
        }
    expect([...new Set(found)]).toEqual([]);
  });
