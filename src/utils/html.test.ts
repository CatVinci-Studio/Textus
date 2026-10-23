import { describe, expect, it } from "vitest";
import { escapeHtml } from "./html";

describe("escapeHtml", () => {
  it("escapes what could end an element's text or a quoted attribute", () => {
    expect(escapeHtml(`a "b" & <c>`)).toBe("a &quot;b&quot; &amp; &lt;c&gt;");
  });

  it("escapes an ampersand once, not the entities it writes", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});
