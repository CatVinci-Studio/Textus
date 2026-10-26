// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cleanPastedHtml } from "./paste-html";

describe("cleanPastedHtml", () => {
  it("makes Google Docs' styled spans bold, italic and struck", () => {
    const docs =
      '<b style="font-weight:normal" id="docs-internal-guid-1"><p><span style="font-weight:700">Friday</span> and <span style="font-style:italic">mostly</span> <span style="text-decoration:line-through">(old)</span></p></b>';
    const out = cleanPastedHtml(docs);
    expect(out).toContain("<strong>Friday</strong>");
    expect(out).toContain("<em>mostly</em>");
    expect(out).toContain("<del>(old)</del>");
    // The wrapper itself is not bold.
    expect(out).toMatch(/^<b style="font-weight:normal"/);
  });

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

  it("unwraps Outlook's Safe Links", () => {
    const html =
      '<a href="https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2Fdesign&amp;data=05" title="Original URL">design</a>';
    expect(cleanPastedHtml(html)).toBe(
      '<a href="https://example.com/design">design</a>',
    );
  });

  it("leaves Textus's own copies as they are", () => {
    const own =
      '<p data-pm-slice="1 1 []"><span style="font-weight:700">x</span></p><p></p>';
    expect(cleanPastedHtml(own)).toBe(own);
  });
});
