// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { closeViews, openView } from "../editor-view-kit";

// An AI chat's answer copied from its page: the formulas are text in its
// HTML (#826), "$$E = mc^2$$" came in escaped instead of as maths.

afterEach(closeViews);

const open = () => openView("", { enableCompletion: false });

it("a formula written as text in pasted HTML comes in as maths", async () => {
  const t = await open();
  t.paste(
    "Energy:\n\n$$E = mc^2$$\n\nwhere $m$ is mass.",
    "<p><strong>Energy:</strong></p><p>$$E = mc^2$$</p><p>where $m$ is mass.</p>",
  );
  const md = t.markdown();
  expect(md).toContain("$$\nE = mc^2\n$$");
  expect(md).toContain("where $m$ is mass.");
  expect(md).not.toContain("\\$");
});

it("dollars that are money stay text", async () => {
  const t = await open();
  t.paste("It costs $5 and $10.", "<p><em>It</em> costs $5 and $10.</p>");
  expect(t.markdown()).not.toMatch(/\$5 and \$10\$/);
  expect(t.view.dom.querySelector('[data-type="math_inline"]')).toBeNull();
});

it("Textus's own copy keeps a dollar it holds as text", async () => {
  const t = await open();
  t.paste("a $b$ c", '<p data-pm-slice="1 1 []"><strong>a</strong> $b$ c</p>');
  expect(t.view.dom.querySelector('[data-type="math_inline"]')).toBeNull();
});
