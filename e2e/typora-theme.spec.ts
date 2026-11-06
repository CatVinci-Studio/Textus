import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openApp, pasteMarkdown } from "./helpers";
import { computed, importTheme, installThemeBackend } from "./theme-import";

// A Typora theme's parts written for Typora's own DOM (CodeMirror tokens, its
// variables, its task, front matter and image classes) reach ours.

const THEME = readFileSync(
  new URL("./fixtures/themes/codemirror-like.css", import.meta.url),
  "utf8",
);

const DOC = `---
title: Notes
---

- [x] done
- [ ] open

\`\`\`js
const greeting = "hi"; // say it
\`\`\`

![a picture](missing.png)
`;

test("an imported Typora theme's code, font, selection and block classes apply", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, DOC);
  await installThemeBackend(page, { "/themes/cm.css": THEME });
  await importTheme(page, "/themes/cm.css");

  const style = (selector: string, prop: string) =>
    computed(page, selector, prop);
  await expect
    .poll(() => style("pre .token.keyword", "color"))
    .toBe("rgb(198, 120, 221)");
  expect(await style("pre .token.string", "color")).toBe("rgb(152, 195, 121)");
  expect(await style("pre .token.comment", "color")).toBe("rgb(92, 99, 112)");
  expect(await style(".md-fences pre", "color")).toBe("rgb(171, 178, 191)");
  expect(await style("pre code", "font-family")).toContain("Courier New");
  expect(await style("#write li p::selection", "background-color")).toBe(
    "rgb(64, 96, 160)",
  );
  expect(await style("#write li p::selection", "color")).toBe(
    "rgb(250, 250, 250)",
  );
  expect(await style('li[data-checked="true"]', "background-color")).toBe(
    "rgb(40, 60, 40)",
  );
  expect(await style('li[data-checked="false"]', "background-color")).not.toBe(
    "rgb(40, 60, 40)",
  );
  expect(await style(".frontmatter-block", "background-color")).toBe(
    "rgb(60, 40, 40)",
  );
  expect(await style(".image-view", "background-color")).toBe(
    "rgb(40, 40, 60)",
  );
});
