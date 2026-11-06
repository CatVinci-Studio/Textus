// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeViews, openView } from "../../document-view/editor-view-kit";
import { htmlTableToMarkdown } from "./html-table-markdown";
import { htmlTableItems } from "../editor-menu-tables";
import { resolveStrings } from "../../i18n/strings";
import type { EditorRunner } from "../useEditorRunner";
import type { ContextMenuItem } from "../../ui/ContextMenu";

afterEach(closeViews);

// An undo scrolls the caret into view, measuring a Range jsdom can't.
beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

const t = resolveStrings("en");

describe("htmlTableToMarkdown", () => {
  it("writes the header, alignment, inline formatting and empty cells", () => {
    const html = `<table>
      <thead><tr><th align="left">Name</th><th style="text-align: center">Value</th><th align="right">Note</th></tr></thead>
      <tbody>
        <tr><td><b>bold</b> and <i>it</i></td><td>$ x^2 $</td><td></td></tr>
        <tr><td><code>a|b</code></td><td>H<sub>2</sub>O and x<sup>2</sup></td><td>one<br>two <a href="https://e.com">link</a></td></tr>
      </tbody></table>`;
    expect(htmlTableToMarkdown(html)).toEqual({
      markdown: [
        "| Name | Value | Note |",
        "| :--- | :---: | ---: |",
        "| **bold** and *it* | $x^2$ |  |",
        "| `a\\|b` | H~2~O and x^2^ | one<br>two [link](https://e.com) |",
      ].join("\n"),
    });
  });

  it("takes the first row as the header when there is no <th>", () => {
    expect(
      htmlTableToMarkdown(
        "<table><tr><td>a</td><td>b|c</td></tr><tr><td>1</td></tr></table>",
      ),
    ).toEqual({ markdown: "| a | b\\|c |\n| --- | --- |\n| 1 |  |" });
  });

  it("heads the table with its <th> row, wherever it stands", () => {
    expect(
      htmlTableToMarkdown(
        "<table><tr><td>Note</td><td>2025</td></tr><tr><th>Name</th><th>Year</th></tr><tr><td>A</td><td>1</td></tr></table>",
      ),
    ).toEqual({
      markdown: "| Name | Year |\n| --- | --- |\n| Note | 2025 |\n| A | 1 |",
    });
  });

  it("leaves a price's dollar sign alone", () => {
    const result = htmlTableToMarkdown(
      "<table><tr><td>h</td></tr><tr><td>$5 and $6</td></tr></table>",
    );
    expect(result).toEqual({ markdown: "| h |\n| --- |\n| $5 and $6 |" });
  });

  it.each([
    ['<table><tr><td colspan="2">a</td></tr></table>', "merged"],
    ['<table><tr><td rowspan="2">a</td></tr></table>', "merged"],
    ["<table><tr><td><p>a</p><p>b</p></td></tr></table>", "blocks"],
    ["<table><tr><td><ul><li>a</li></ul></td></tr></table>", "blocks"],
    ["<p>no table</p>", "notTable"],
    ["<table><tr><td>a</td></tr></table><p>more</p>", "notTable"],
  ])("refuses %j", (html, refused) => {
    expect(htmlTableToMarkdown(html)).toEqual({ refused });
  });
});

describe("HTML tables in the editor", () => {
  it("pastes the source of a simple HTML table as a Markdown table", async () => {
    const view = await openView("");
    view.paste(
      "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
    );
    expect(view.markdown()).toBe("| A | B |\n| - | - |\n| 1 | 2 |");
  });

  it("converts an HTML table from the menu in one undo step", async () => {
    const source =
      "<table><tr><th>A</th></tr><tr><td><b>1</b></td></tr></table>";
    const view = await openView(`${source}\n\nafter\n`);
    view.caretAt("<table>", 1);
    const run: EditorRunner = (fn) => view.editor.action(fn);
    const [item] = htmlTableItems(run, t) as ContextMenuItem[];
    expect(item.label).toBe(t.tableToMarkdown);
    item.onSelect();
    expect(view.markdown()).toBe("| A     |\n| ----- |\n| **1** |\n\nafter");
    view.press("Mod+z");
    expect(view.markdown()).toBe(`${source}\n\nafter`);
  });

  it("offers the item disabled, with the reason, for merged cells", async () => {
    const view = await openView(
      '<table><tr><td colspan="2">a</td></tr></table>\n',
    );
    view.caretAt("<table>", 1);
    const run: EditorRunner = (fn) => view.editor.action(fn);
    const [item] = htmlTableItems(run, t) as ContextMenuItem[];
    expect(item).toMatchObject({
      label: t.tableToMarkdownMerged,
      disabled: true,
    });
  });
});
