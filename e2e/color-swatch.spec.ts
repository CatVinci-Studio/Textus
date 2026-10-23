import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// #146: a colour code gets a small swatch of its colour before it, as
// Settings › Editor & Appearance › Swatches before colour codes says: off
// (the default); in code only - inline code that is a colour and colour
// literals in code blocks; or everywhere - also a hex code or colour
// function written in the text of a paragraph, heading, list, quote or
// table. The text itself is unchanged, and so is the way the caret moves
// through it, what find finds and what is saved.

const editor = '[data-active-tab="true"] .ProseMirror';
/** Settings.colorSwatches. */
type ColorSwatchMode = "off" | "code" | "everywhere";
const swatch = `${editor} .color-swatch`;

const DOC = "White `#fff`, blue `rgb(0 128 255)` and plain `red`.";

async function open(page: Page, mode: ColorSwatchMode, doc = DOC) {
  await openApp(page, {
    settings: { language: "en", colorSwatches: mode },
  });
  await pasteMarkdown(page, doc);
  if (doc === DOC) await expect(page.locator(`${editor} code`)).toHaveCount(3);
}

test("there are no swatches by default", async ({ page }) => {
  await open(page, "off");
  await expect(page.locator(swatch)).toHaveCount(0);
});

test("a hex or rgb() code gets a swatch of its colour, a colour name doesn't", async ({
  page,
}) => {
  await open(page, "everywhere");
  await expect(page.locator(swatch)).toHaveCount(2);
  const colours = await page
    .locator(swatch)
    .evaluateAll((els) =>
      els.map((el) => [
        el.closest("code")?.textContent,
        (el as HTMLElement).style.getPropertyValue("--color-swatch"),
      ]),
    );
  expect(colours).toEqual([
    ["#fff", "#fff"],
    ["rgb(0 128 255)", "rgb(0 128 255)"],
  ]);
  // The code keeps its own look: no colour of its own.
  const [plain, coded] = await page
    .locator(`${editor} code`)
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor))
    .then((bgs) => [bgs[2], bgs[0]]);
  expect(coded).toBe(plain);
});

test("swatches stay out of a printout", async ({ page }) => {
  await open(page, "everywhere");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(swatch).first()).toBeHidden();
});

/** The paragraph's content as the editor holds it. */
const paragraph = (page: Page) =>
  page.evaluate(() => {
    const view = document.querySelector(
      '[data-active-tab="true"] .ProseMirror',
    ) as unknown as {
      pmViewDesc: { node: { firstChild: { toJSON(): unknown } } };
    };
    return JSON.stringify(view.pmViewDesc.node.firstChild.toJSON());
  });

async function keys(page: Page, ...presses: string[]) {
  for (const key of presses) {
    await page.keyboard.press(key);
    // Where the editor reads the moved caret (selectionchange).
    await page.waitForTimeout(30);
  }
}

/** Runs the same keys with swatches off and on; the text must come out
 *  the same - the swatch is no stop on the caret's way. */
async function sameWithAndWithout(
  page: Page,
  run: (page: Page) => Promise<void>,
  doc = DOC,
) {
  const results: string[] = [];
  for (const mode of ["off", "everywhere"] as const) {
    await open(page, mode, doc);
    await page.locator(`${editor} p`).click();
    await run(page);
    results.push(await paragraph(page));
  }
  expect(results[1]).toBe(results[0]);
  return JSON.parse(results[1]) as {
    content: { type: string; text?: string; content?: { text: string }[] }[];
  };
}

test("the caret steps into a colour code from the left as it does without the swatch", async ({
  page,
}) => {
  const result = await sameWithAndWithout(page, async (p) => {
    // "White " then the span: six steps to its edge, one more inside.
    await keys(p, "Home", ...Array(7).fill("ArrowRight"));
    await p.keyboard.type("X");
  });
  expect(result.content[1].content?.[0].text).toBe("X#fff");
});

test("the caret steps out of a colour code to the left as it does without the swatch", async ({
  page,
}) => {
  const result = await sameWithAndWithout(page, async (p) => {
    // To the end of "#fff", then back across it and out of the span.
    await keys(p, "Home", ...Array(11).fill("ArrowRight"));
    await keys(p, ...Array(5).fill("ArrowLeft"));
    await p.keyboard.type("Y");
  });
  expect(result.content[0].text).toBe("White Y");
  expect(result.content[1].content?.[0].text).toBe("#fff");
});

const RICH = [
  "# Brand #1e90ff",
  "",
  "Orange #ff8800 and rgb(0 128 255), tagged #add #cafe, issue #234, [#00ff00](https://x.org) and https://x.org/#a1b2c3.",
  "",
  "- A list item #ff0000, but not the short #f00",
  "",
  "> A quote hsl(120 50% 50%)",
  "",
  "| Name | Code |",
  "| --- | --- |",
  "| Teal | #008080 |",
  "",
  "Inline `#ff00ff`, short `#f0f` and `red`.",
  "",
  "```css",
  "a { color: #ff8800; border-color: #fff; } /* see #234 */",
  "#fed { }",
  "```",
  "",
].join("\n");

const textSwatch = `${editor} .color-swatch-text`;

/** Each plain-text swatch: the block it is in, its colour, and the code's
 *  first character it is drawn before. */
const textSwatches = (page: Page) =>
  page
    .locator(textSwatch)
    .evaluateAll((els) =>
      els.map((el) => [
        (el.closest("h1, li, blockquote, td, pre") ?? el.closest("p"))?.tagName,
        (el as HTMLElement).style.getPropertyValue("--color-swatch"),
        el.textContent,
      ]),
    );

test("everywhere: a colour code in a heading, paragraph, list, quote, table or code block gets a swatch; tags, issues and links don't", async ({
  page,
}) => {
  await open(page, "everywhere", RICH);
  await expect(page.locator(`${editor} table`)).toBeVisible();
  expect(await textSwatches(page)).toEqual([
    ["H1", "#1e90ff", "#"],
    ["P", "#ff8800", "#"],
    ["P", "rgb(0 128 255)", "r"],
    ["LI", "#ff0000", "#"],
    ["BLOCKQUOTE", "hsl(120 50% 50%)", "h"],
    ["TD", "#008080", "#"],
    // Short hex counts in code, an id selector doesn't.
    ["PRE", "#ff8800", "#"],
    ["PRE", "#fff", "#"],
  ]);
  // Inline code keeps its own swatch, short hex too.
  await expect(page.locator(swatch)).toHaveCount(2);
  // The swatch is drawn before the code without adding any text.
  const before = await page
    .locator(textSwatch)
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el, "::before");
      return { width: parseFloat(style.width), content: style.content };
    });
  expect(before.width).toBeGreaterThan(5);
  expect(before.content).toBe('""');
  await expect(page.locator(`${editor} h1`)).toHaveText("Brand #1e90ff");
});

test("every swatch is painted, in its colour, at a size that shows", async ({
  page,
}) => {
  await open(page, "everywhere", RICH);
  await expect(page.locator(`${editor} table`)).toBeVisible();
  // In the DOM is not enough: each swatch's box (inline code's element,
  // plain text's ::before) must have a size and paint its colour.
  const painted = await page.evaluate((selector) => {
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const rgb = (value: string) => {
      probe.style.color = value;
      return getComputedStyle(probe).color;
    };
    const result = Array.from(
      document.querySelectorAll<HTMLElement>(
        `${selector} .color-swatch, ${selector} .color-swatch-text`,
      ),
    ).map((el) => {
      const inCode = el.classList.contains("color-swatch");
      const style = getComputedStyle(el, inCode ? null : "::before");
      const box = inCode
        ? el.getBoundingClientRect()
        : { width: parseFloat(style.width), height: parseFloat(style.height) };
      const colour = el.style.getPropertyValue("--color-swatch");
      return {
        colour,
        shows:
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          box.width > 5 &&
          box.height > 5,
        paints: style.backgroundImage.includes(rgb(colour)),
      };
    });
    probe.remove();
    return result;
  }, editor);
  expect(painted.map((p) => p.colour)).toEqual([
    "#1e90ff",
    "#ff8800",
    "rgb(0 128 255)",
    "#ff0000",
    "hsl(120 50% 50%)",
    "#008080",
    "#ff00ff",
    "#f0f",
    "#ff8800",
    "#fff",
  ]);
  for (const p of painted)
    expect(p, p.colour).toMatchObject({ shows: true, paints: true });
});

test("in code only: inline code and code blocks get swatches, the text doesn't", async ({
  page,
}) => {
  await open(page, "code", RICH);
  await expect(page.locator(`${editor} table`)).toBeVisible();
  expect(await textSwatches(page)).toEqual([
    ["PRE", "#ff8800", "#"],
    ["PRE", "#fff", "#"],
  ]);
  await expect(page.locator(swatch)).toHaveCount(2);
  // The code block keeps its text and its highlighting.
  const pre = page.locator(`${editor} pre`);
  await expect(pre).toContainText("a { color: #ff8800; border-color: #fff; }");
  await expect(pre.locator(".token").first()).toBeVisible();
});

test("there are no swatches with the setting off", async ({ page }) => {
  await open(page, "off", RICH);
  await expect(page.locator(`${editor} table`)).toBeVisible();
  await expect(page.locator(textSwatch)).toHaveCount(0);
  await expect(page.locator(swatch)).toHaveCount(0);
});

test("a plain-text swatch stays out of a printout", async ({ page }) => {
  await open(page, "everywhere", RICH);
  await page.emulateMedia({ media: "print" });
  const display = await page
    .locator(textSwatch)
    .first()
    .evaluate((el) => getComputedStyle(el, "::before").display);
  expect(display).toBe("none");
});

test("a swatch follows a colour code as it is typed and unmade", async ({
  page,
}) => {
  await open(page, "everywhere", "Accent here.");
  await page.locator(`${editor} p`).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" #ff880");
  await expect(page.locator(textSwatch)).toHaveCount(0);
  await page.keyboard.type("0");
  await expect(page.locator(textSwatch)).toHaveCount(1);
  await page.keyboard.type("x");
  await expect(page.locator(textSwatch)).toHaveCount(0);
  await page.keyboard.press("Backspace");
  await expect(page.locator(textSwatch)).toHaveCount(1);
  await expect(page.locator(`${editor} p`)).toHaveText("Accent here. #ff8800");
});

test("the caret crosses a plain-text colour code as it does without the swatch", async ({
  page,
}) => {
  const doc = "Orange #ff8800 here.";
  const into = await sameWithAndWithout(
    page,
    async (p) => {
      // "Orange " and the "#": eight steps.
      await keys(p, "Home", ...Array(8).fill("ArrowRight"));
      await p.keyboard.type("X");
    },
    doc,
  );
  expect(into.content[0].text).toBe("Orange #Xff8800 here.");
  const before = await sameWithAndWithout(
    page,
    async (p) => {
      // From the end, back over " here." and the code to just before it.
      await keys(p, "End", ...Array(13).fill("ArrowLeft"));
      await p.keyboard.type("Y");
    },
    doc,
  );
  expect(before.content[0].text).toBe("Orange Y#ff8800 here.");
});

function emit(page: Page, name: string) {
  return page.evaluate(
    (n) =>
      (
        window as unknown as { __devEmitTauriEvent: (name: string) => void }
      ).__devEmitTauriEvent(n),
    name,
  );
}

test("find matches inside a colour code, which keeps one swatch", async ({
  page,
}) => {
  await open(page, "everywhere", "Orange #ff8800 and #ff8800aa.");
  await expect(page.locator(textSwatch)).toHaveCount(2);
  await emit(page, "menu-find-replace");
  await page.locator(".find-replace-input").first().fill("#ff88");
  await expect(page.locator(".find-replace-count")).toContainText("2");
  // A match's highlight runs on across the swatch's character.
  await expect
    .poll(() =>
      page
        .locator(`${editor} .find-match`)
        .evaluateAll((els) => els.map((el) => el.textContent).join("")),
    )
    .toBe("#ff88#ff88");
  await expect(page.locator(textSwatch)).toHaveCount(2);
});

const PATH = "/home/me/colours.md";

test("swatches never reach the saved file", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en", autosave: true, colorSwatches: "everywhere" },
  });
  // A stand-in for commands/fs.rs, as in autosave.spec.ts.
  await page.evaluate(
    ({ path, text }) => {
      const w = window as unknown as Record<string, unknown> & {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
        };
        __devEmitTauriEvent: (name: string, payload: unknown) => void;
      };
      const writes: string[] = [];
      w.__writes = writes;
      const original = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = (cmd, args = {}) => {
        if (args.path === path) {
          if (cmd === "read_text_file") return Promise.resolve(text);
          if (cmd === "file_mtime_ms") return Promise.resolve(writes.length);
          if (cmd === "write_text_file") {
            writes.push(String(args.contents));
            return Promise.resolve(null);
          }
        }
        return original(cmd, args);
      };
      w.__devEmitTauriEvent("tauri://drag-drop", {
        paths: [path],
        position: { x: 0, y: 0 },
      });
    },
    { path: PATH, text: RICH },
  );
  await expect(page.locator(textSwatch)).toHaveCount(8);
  await page.locator(`${editor} h1`).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" and #00ff00");
  await expect(page.locator(textSwatch)).toHaveCount(9);
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __writes: string[] }).__writes,
        ),
      { timeout: 6000 },
    )
    .toEqual([RICH.replace("# Brand #1e90ff", "# Brand #1e90ff and #00ff00")]);
});

test("In code only draws swatches in inline code, and each choice in Settings applies at once", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", colorSwatches: "code" },
  });
  await pasteMarkdown(page, RICH);
  await expect(page.locator(swatch)).toHaveCount(2);
  await expect(page.locator(textSwatch)).toHaveCount(2);

  await emit(page, "menu-open-settings");
  const panel = page.getByRole("dialog", { name: "Settings" });
  await panel.getByRole("button", { name: "Editor & Appearance" }).click();
  const select = panel.getByRole("combobox", {
    name: "Swatches before colour codes",
  });
  await expect(select).toContainText("In code only");
  const choose = async (name: string) => {
    await select.click();
    await page.getByRole("option", { name }).click();
  };
  await choose("Everywhere");
  await expect(page.locator(textSwatch)).toHaveCount(8);
  await choose("Off");
  await expect(page.locator(textSwatch)).toHaveCount(0);
  await expect(page.locator(swatch)).toHaveCount(0);
  await choose("In code only");
  await expect(page.locator(swatch)).toHaveCount(2);
  await expect(page.locator(textSwatch)).toHaveCount(2);
});
