import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { pluginsCheckout } from "../vite.dev-plugins";
import { PHONE } from "./helpers";
import {
  hasPlugin,
  minimalDocx,
  minimalPdf,
  openPath,
  openWithPlugins,
  PNG,
  tabFrame,
} from "./plugin-helpers";

// Every official plugin page at a phone's width: nothing reaches past its
// right edge, a bar of controls takes at most two rows, and nothing to tap
// is smaller than a fingertip's least, counting
// the tap area a small control takes around it. Which platforms a page was looked at
// on is answered here, not by hand. In the full suite only (a version's
// pull request and the release): a page is the plugin's, checked before
// the app that shows it ships.

const PAGES: [plugin: string, file: string][] = [
  ["catvinci.kanban", "board.md"],
  ["catvinci.canvas", "map.canvas"],
  ["catvinci.pdf-viewer", "doc.pdf"],
  ["catvinci.image-viewer", "pic.png"],
  ["catvinci.word-reader", "letter.docx"],
  ["catvinci.database", "tasks.base"],
];

/** The least a control to tap measures across, in the page's pixels. */
const LEAST_TAP_PX = 24;

const permissions = (id: string): string[] =>
  JSON.parse(
    readFileSync(
      join(pluginsCheckout()!, "plugins", id, "textus-plugin.json"),
      "utf8",
    ),
  ).permissions ?? [];

test.use(PHONE);

test("each official plugin page fits a phone's width, its bars and controls a finger's", async ({
  page,
}) => {
  test.skip(!process.env.E2E_FULL, "the full suite's");
  test.skip(!PAGES.every(([id]) => hasPlugin(id)), "no plugins checkout");
  await openWithPlugins(page, {
    plugins: Object.fromEntries(PAGES.map(([id]) => [id, permissions(id)])),
    folder: {
      "/work/notes/board.md":
        "---\nkanban-plugin: board\n---\n\n## Todo\n\n- [ ] Outline\n\n## Done\n\n- [x] Title\n",
      "/work/notes/map.canvas": JSON.stringify({
        nodes: [
          {
            id: "a",
            type: "text",
            text: "Idea",
            x: 0,
            y: 0,
            width: 200,
            height: 80,
          },
        ],
        edges: [],
      }),
      "/work/notes/tasks.base": "views:\n  - type: table\n    name: Table\n",
    },
    binary: {
      "/work/notes/doc.pdf": minimalPdf("Hello"),
      "/work/notes/pic.png": PNG,
      "/work/notes/letter.docx": await minimalDocx("First paragraph."),
    },
  });
  const found: Record<
    string,
    { overflow: number; mostRows: number; small: string[] }
  > = {};
  for (const [, file] of PAGES) {
    await openPath(page, `/work/notes/${file}`);
    const frame = tabFrame(page);
    await expect(frame.locator("body")).not.toBeEmpty();
    found[file] = await frame.locator("html").evaluate((html, least) => {
      const shown = (el: Element) =>
        el.checkVisibility() && el.getBoundingClientRect().width > 0;
      // A bar of controls: rows counted by where its children start.
      const bars = Array.from(
        document.querySelectorAll(
          "[data-fit-steps], .tx-toolbar, [role=toolbar]",
        ),
      )
        .filter(shown)
        .map((bar) => {
          const tops = new Set(
            Array.from(bar.children)
              .filter(shown)
              .map((c) => Math.round(c.getBoundingClientRect().top / 4)),
          );
          return tops.size;
        });
      const small = Array.from(
        document.querySelectorAll(
          "button, [role=button], .tx-icon-button, input[type=checkbox], .ui-check",
        ),
      )
        .filter(shown)
        .filter((el) => {
          const box = el.getBoundingClientRect();
          if (Math.max(box.width, box.height) >= least) return false;
          // Drawn small, it may still take a tap around it (a checkbox's
          // hit area): just outside what is drawn must reach it.
          const x = box.right + 4;
          if (x >= innerWidth) return false;
          const beside = document.elementFromPoint(x, box.top + box.height / 2);
          return !(beside === el || (beside && el.contains(beside)));
        })
        .map((el) => el.outerHTML.slice(0, 80));
      return {
        overflow: html.scrollWidth - html.clientWidth,
        mostRows: Math.max(0, ...bars),
        small,
      };
    }, LEAST_TAP_PX);
  }
  for (const [, file] of PAGES) {
    const { overflow, mostRows, small } = found[file];
    expect({ overflow, small }, file).toEqual({ overflow: 0, small: [] });
    expect(mostRows, `${file}: a bar's rows`).toBeLessThanOrEqual(2);
  }
});
