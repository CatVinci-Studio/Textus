// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cleanPastedHtml } from "./paste-html";

describe("cleanPastedHtml", () => {
  it("leaves a heading's weight and code alone", () => {
    const html =
      '<h1><span style="font-weight:400">Trip</span></h1><pre><span style="font-weight:bold">x</span></pre>';
    expect(cleanPastedHtml(html)).toBe(html);
  });

  it("makes Word for the web's headings headings", () => {
    expect(
      cleanPastedHtml(
        '<p role="heading" aria-level="2"><span>Notes</span></p>',
      ),
    ).toBe("<h2><span>Notes</span></h2>");
  });

  it("drops mail's empty paragraphs and the breaks between blocks", () => {
    const outlook =
      '<p class="MsoNormal">Hi Chen,</p><p class="MsoNormal"><o:p>&nbsp;</o:p></p><p class="MsoNormal">Thanks,</p>';
    expect(cleanPastedHtml(outlook)).toBe(
      '<p class="MsoNormal">Hi Chen,</p><p class="MsoNormal">Thanks,</p>',
    );
    expect(cleanPastedHtml("<p>One</p><br><p>Two</p>")).toBe(
      "<p>One</p><p>Two</p>",
    );
    // A break inside a paragraph is a line of it.
    expect(cleanPastedHtml("<p>One<br>Two</p>")).toBe("<p>One<br>Two</p>");
  });

  it("splits a table's merged cells back into their places", () => {
    const html =
      "<table><tr><th colspan=2>Head</th><th>C</th></tr>" +
      "<tr><td rowspan=2>Left</td><td>b1</td><td>c1</td></tr>" +
      "<tr><td>b2</td><td>c2</td></tr></table>";
    const out = document.createElement("div");
    out.innerHTML = cleanPastedHtml(html);
    const rows = [...out.querySelectorAll("tr")].map((tr) =>
      [...tr.children].map((c) => `${c.localName}:${c.textContent}`),
    );
    expect(rows).toEqual([
      ["th:Head", "th:", "th:C"],
      ["td:Left", "td:b1", "td:c1"],
      ["td:", "td:b2", "td:c2"],
    ]);
    expect(out.querySelector("[colspan],[rowspan]")).toBeNull();
  });

  it("leaves Textus's own copies as they are", () => {
    const own =
      '<p data-pm-slice="1 1 []"><span style="font-weight:700">x</span></p><p></p>';
    expect(cleanPastedHtml(own)).toBe(own);
  });
});
