// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeNodes, sanitizeStyle, svgDataUrl } from "./html-policy";
import { renderWhitelistedHtml } from "./raw-html-sanitize";
import { renderDocumentHtml } from "../markdown/render-html";

/** `html` through the policy, as markup. */
function clean(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = doc.createElement("div");
  sanitizeNodes(Array.from(doc.body.childNodes), out);
  return out.innerHTML;
}

/** The SVG inside the first <img> data URL of `html`, decoded. */
function svgOf(html: string): string {
  const match = /src="data:image\/svg\+xml;charset=utf-8,([^"]*)"/.exec(html);
  expect(match).not.toBeNull();
  return decodeURIComponent(match![1].replace(/&amp;/g, "&"));
}

describe("the HTML policy keeps", () => {
  it("<details> and <summary>, and whether it starts open", () => {
    expect(
      clean("<details open><summary>More</summary><p>Body</p></details>"),
    ).toBe('<details open=""><summary>More</summary><p>Body</p></details>');
  });

  it("an HTML table with numeric spans and alignment", () => {
    const html = clean(
      '<table><thead><tr><th colspan="2" align="center">H</th></tr></thead>' +
        '<tbody><tr><td rowspan="3" align="right">a</td><td>b</td></tr></tbody></table>',
    );
    expect(html).toContain(
      '<th align="center" colspan="2" style="text-align: center">H</th>',
    );
    expect(html).toContain(
      '<td align="right" rowspan="3" style="text-align: right">a</td>',
    );
  });

  it("drops a span or alignment that isn't a plain value", () => {
    const html = clean(
      '<table><tr><td colspan="2;x" rowspan="0" align="middle">a</td><td colspan="99999">b</td></tr></table>',
    );
    expect(html).toContain("<td>a</td>");
    expect(html).toContain("<td>b</td>");
  });

  it.each([
    ["color", "color: red"],
    ["color", "color: #ff0000"],
    ["color", "color: #f00a"],
    ["color", "color: rgb(255, 0, 0)"],
    ["color", "color: rgba(255 0 0 / 50%)"],
    ["color", "color: hsl(120deg, 50%, 40%)"],
    ["background-color", "background-color: yellow"],
    ["font-size", "font-size: 18px"],
    ["font-size", "font-size: 1.5em"],
    ["font-size", "font-size: 2rem"],
    ["font-size", "font-size: 120%"],
    ["font-weight", "font-weight: bold"],
    ["font-weight", "font-weight: 700"],
    ["font-style", "font-style: italic"],
    ["text-align", "text-align: center"],
    ["text-decoration", "text-decoration: underline"],
    ["text-decoration", "text-decoration: line-through"],
    ["text-decoration", "text-decoration: underline line-through"],
  ])("the style property %s (%s)", (_prop, declaration) => {
    expect(sanitizeStyle(declaration)).toBe(declaration);
    expect(clean(`<span style="${declaration}">x</span>`)).toBe(
      `<span style="${declaration}">x</span>`,
    );
  });

  it("only the allowed declarations of a style, normalized", () => {
    expect(
      sanitizeStyle(
        "COLOR: Red; position: fixed; top: 0; font-size: 12px; z-index: 9",
      ),
    ).toBe("color: red; font-size: 12px");
  });

  it("an inline SVG, as an <img> of a data URL", () => {
    const html = clean(
      '<p>Icon <svg width="16" height="16" viewBox="0 0 16 16"><title>Dot</title><circle cx="8" cy="8" r="6" fill="red"/></svg></p>',
    );
    expect(html).toMatch(
      /^<p>Icon <img src="data:image\/svg\+xml;charset=utf-8,[^"]+" class="html-svg" alt="Dot" width="16" height="16"><\/p>$/,
    );
    expect(html).not.toContain("<svg");
    const svg = svgOf(html);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<circle cx="8" cy="8" r="6" fill="red"');
  });

  it("an SVG gradient referenced inside the same picture", () => {
    const svg = svgOf(
      clean(
        '<svg><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect fill="url(#g)" width="10" height="10"/><use href="#g"/></svg>',
      ),
    );
    expect(svg).toContain('fill="url(#g)"');
    expect(svg).toContain('href="#g"');
  });

  it("text and links around what it drops", () => {
    expect(clean('<p>a <a href="https://x.org" title="t">b</a> c</p>')).toBe(
      '<p>a <a href="https://x.org" title="t">b</a> c</p>',
    );
    expect(clean('<a href="notes/other.md">rel</a>')).toBe(
      '<a href="notes/other.md">rel</a>',
    );
    expect(clean('<a href="mailto:a@b.org">m</a>')).toBe(
      '<a href="mailto:a@b.org">m</a>',
    );
  });
});

describe("the HTML policy rejects", () => {
  it("<script>, with its content", () => {
    expect(clean("<p>a<script>alert(1)</script>b</p>")).toBe("<p>ab</p>");
    expect(clean("<script>alert(1)</script>")).toBe("");
  });

  it("<style>, <iframe>, <object>, <embed> and <form>, with their content", () => {
    expect(
      clean(
        '<style>body{display:none}</style><iframe src="https://x.org">t</iframe><object data="x">o</object><embed src="x"><form action="x"><p>f</p></form>ok',
      ),
    ).toBe("ok");
  });

  it("event handler attributes", () => {
    expect(clean('<p onclick="alert(1)" onmouseover="x()">a</p>')).toBe(
      "<p>a</p>",
    );
    expect(clean('<img src="a.png" onerror="alert(1)">')).toBe(
      '<img src="a.png">',
    );
    expect(
      clean('<details ontoggle="alert(1)" open><summary>s</summary></details>'),
    ).toBe('<details open=""><summary>s</summary></details>');
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "vbscript:x",
    "data:text/html,<script>alert(1)</script>",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "file:///etc/passwd",
  ])("the link and image URL %s", (url) => {
    expect(clean(`<a href="${url}">x</a>`)).toBe("<a>x</a>");
    expect(clean(`<img src="${url}">`)).toBe("<img>");
  });

  it("an SVG data URL written as an <img> src (only a cleaned inline SVG becomes one)", () => {
    expect(clean('<img src="data:image/svg+xml,<svg onload=alert(1)>">')).toBe(
      "<img>",
    );
    expect(clean('<img src="data:image/png;base64,iVBORw0KGgo=">')).toBe(
      '<img src="data:image/png;base64,iVBORw0KGgo=">',
    );
  });

  it.each([
    "background: url(https://x.org/a.png)",
    "background-color: url(https://x.org/a.png)",
    "color: expression(alert(1))",
    "color: var(--x)",
    "color: red !important",
    "color: red /* */",
    "color: \\72 ed",
    "font-size: calc(100px + 1em)",
    "font-size: 12pt",
    "font-weight: 950",
    "color: rgb(url(x))",
    "behavior: url(x.htc)",
    "-moz-binding: url(x.xml#x)",
    "position: fixed",
  ])("the style %s", (style) => {
    expect(sanitizeStyle(style)).toBeNull();
    expect(clean(`<span style="${style}">x</span>`)).toBe("<span>x</span>");
  });

  it("an <svg onload>", () => {
    const svg = svgOf(
      clean('<svg onload="alert(1)"><rect width="1" height="1"/></svg>'),
    );
    expect(svg).not.toContain("onload");
    expect(svg).toContain("<rect");
  });

  it("a <script> inside an <svg>", () => {
    const svg = svgOf(
      clean('<svg><script>alert(1)</script><circle r="1"/></svg>'),
    );
    expect(svg).not.toContain("script");
    expect(svg).not.toContain("alert");
  });

  it("a <foreignObject> inside an <svg>", () => {
    const svg = svgOf(
      clean(
        '<svg><foreignObject><iframe src="javascript:alert(1)"></iframe><p>x</p></foreignObject><rect/></svg>',
      ),
    );
    expect(svg.toLowerCase()).not.toContain("foreignobject");
    expect(svg).not.toContain("iframe");
  });

  it('an <a xlink:href="javascript:"> inside an <svg>', () => {
    const svg = svgOf(
      clean(
        '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert(1)"><text>click</text></a><a href="javascript:alert(2)"><rect/></a></svg>',
      ),
    );
    expect(svg).not.toContain("javascript");
    expect(svg).not.toMatch(/<a[\s>]/);
    expect(svg).toContain("click");
  });

  it("SVG animation that can rewrite a link, images, styles and outside references", () => {
    const svg = svgOf(
      clean(
        '<svg><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="href" values="javascript:alert(1)"/>' +
          '<image href="https://x.org/a.png"/><style>@import url(https://x.org/a.css)</style>' +
          '<use href="https://x.org/s.svg#a"/><rect fill="url(https://x.org/p)" style="fill: url(https://x.org/q)"/></svg>',
      ),
    );
    expect(svg).not.toMatch(/<(set|animate|image|style)\b/);
    expect(svg).not.toContain("x.org");
  });

  it("an SVG that is never a live element, even in the editor's widget", () => {
    const rendered = renderWhitelistedHtml(
      '<svg onload="alert(1)"><script>alert(2)</script></svg>',
    );
    expect(rendered).not.toBeNull();
    expect(rendered!.html).toMatch(/^<img src="data:image\/svg\+xml/);
    expect(rendered!.inline).toBe(true);
    expect(
      svgDataUrl(document.createElementNS("http://www.w3.org/2000/svg", "svg")),
    ).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  });

  it("ids, names and classes that could clobber the page", () => {
    expect(clean('<p id="app" name="x" class="ProseMirror">a</p>')).toBe(
      "<p>a</p>",
    );
    expect(clean('<code class="language-js x">a</code>')).toBe(
      "<code>a</code>",
    );
    expect(clean('<code class="language-js">a</code>')).toBe(
      '<code class="language-js">a</code>',
    );
  });

  it("form fields other than a disabled checkbox", () => {
    expect(clean('<input type="text" value="x">')).toBe("");
    expect(clean('<input type="checkbox" checked>')).toBe(
      '<input type="checkbox" disabled="" checked="">',
    );
  });
});

describe("nesting", () => {
  it("unwraps an unknown tag around allowed content, keeping its text", () => {
    expect(clean("<section><b>a</b> b</section>")).toBe("<b>a</b> b");
  });

  it("drops a script hidden in a summary or a table cell", () => {
    expect(
      clean(
        "<details><summary>S<script>alert(1)</script></summary><table><tr><td><script>alert(2)</script>c</td></tr></table></details>",
      ),
    ).toBe(
      "<details><summary>S</summary><table><tbody><tr><td>c</td></tr></tbody></table></details>",
    );
  });

  it("turns an SVG inside a link inside a table cell into a picture", () => {
    const html = clean(
      '<table><tr><td><a href="javascript:x"><svg onload="x()"><rect/></svg></a></td></tr></table>',
    );
    expect(html).toMatch(/<td><a><img src="data:image\/svg\+xml/);
    expect(svgOf(html)).not.toContain("onload");
  });

  it("an SVG inside an SVG stays inside the one picture", () => {
    const html = clean('<svg><svg onload="x()"><circle r="1"/></svg></svg>');
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(svgOf(html)).not.toContain("onload");
  });

  it("an HTML element smuggled into an SVG doesn't come back out as HTML", () => {
    const html = clean(
      '<svg><p onclick="x()">t</p><img src=x onerror=alert(1)></svg>',
    );
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("onclick");
  });

  it("mutation-prone markup comes out inert", () => {
    for (const payload of [
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
      "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
      '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
      "<template><script>alert(1)</script></template>",
    ]) {
      const out = clean(payload);
      // Parsed again, the output has no handler and no script.
      const reparsed = new DOMParser().parseFromString(out, "text/html");
      expect(reparsed.querySelector("script")).toBeNull();
      for (const el of Array.from(reparsed.querySelectorAll("*")))
        for (const attr of Array.from(el.attributes))
          expect(attr.name.startsWith("on")).toBe(false);
    }
  });
});

describe("both views read the one policy", () => {
  const SNIPPETS = [
    "<details><summary>More</summary>Body</details>",
    '<table><tr><th align="center">H</th></tr><tr><td colspan="2">a</td></tr></table>',
    '<div style="color: red; position: fixed">c</div>',
    '<p align="center"><svg width="10" height="10"><circle r="4"/></svg></p>',
    '<p onclick="x()"><a href="javascript:x">j</a><script>y()</script></p>',
  ];

  it.each(SNIPPETS)("%s", (snippet) => {
    // The split view's preview of a document that is just this block,
    // and the editor's widget for it: the same markup, but for the
    // editor's link target.
    const split = renderDocumentHtml(snippet);
    const editor = renderWhitelistedHtml(snippet)!.html.replace(
      / rel="noopener noreferrer" target="_blank"/g,
      "",
    );
    expect(split).toBe(editor);
  });

  it("the split view keeps markdown's own output and KaTeX", () => {
    const html = renderDocumentHtml(
      "# T\n\n- [x] done\n\n```js\nx\n```\n\n| a |\n|:-:|\n| b |\n\nMath $x^2$ here.\n\n$$\ny\n$$\n",
    );
    expect(html).toContain("<h1>T</h1>");
    expect(html).toContain('<input type="checkbox" disabled="" checked="">');
    expect(html).toContain('<code class="language-js">');
    expect(html).toContain('style="text-align: center"');
    expect(html).toContain('class="katex"');
    expect(html).toContain('<div class="agent-math">');
    expect(html).not.toContain("textus-math");
  });

  it("the split view renders an inline SVG inside a paragraph as a picture", () => {
    const html = renderDocumentHtml(
      'An icon <svg width="8" height="8"><circle r="4" onclick="x()"/></svg> inline.',
    );
    expect(html).toMatch(/^<p>An icon <img src="data:image\/svg\+xml/);
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("onclick");
  });

  it("the split view folds markdown inside a <details> written around it", () => {
    const html = renderDocumentHtml(
      "<details>\n<summary>More</summary>\n\nSome **bold** text.\n\n</details>\n",
    );
    expect(html.replace(/\n/g, "")).toBe(
      "<details><summary>More</summary><p>Some <strong>bold</strong> text.</p></details>",
    );
  });
});
