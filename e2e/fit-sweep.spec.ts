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
        storage: { "textus-panel-width": String(width) },
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
