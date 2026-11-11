import { describe, expect, it } from "vitest";
import { escapeHtml, styleText } from "./html";

describe("escapeHtml", () => {
  it("escapes what could end an element's text or a quoted attribute", () => {
    expect(escapeHtml(`a "b" & <c>`)).toBe("a &quot;b&quot; &amp; &lt;c&gt;");
  });

  it("escapes an ampersand once, not the entities it writes", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("styleText", () => {
  it("can't close the style element it goes in", () => {
    const css = 'a::after{content:"</style><script>x()</script>"}';
    expect(styleText(css)).not.toMatch(/<\/style/i);
    expect(styleText("a{color:red}")).toBe("a{color:red}");
  });
});
