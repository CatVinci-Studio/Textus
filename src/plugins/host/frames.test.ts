// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { inElement } from "./frames";

/** What the HTML parser makes of `<script>code</script>`: the text it hands
 *  the script, and whether the element ended where it should. */
function parsed(code: string): { text: string; ended: boolean } {
  const doc = new DOMParser().parseFromString(
    `<script>${inElement(code, "script")}</script><p id="after"></p>`,
    "text/html",
  );
  const script = doc.querySelector("script");
  return {
    text: script?.textContent ?? "",
    ended:
      !!doc.getElementById("after") &&
      doc.querySelectorAll("script").length === 1,
  };
}

describe("code inside a script element", () => {
  // jsdom's parser doesn't fall into the escaped states a browser's does;
  // e2e/plugin-api.spec.ts loads such a plugin in Chromium.
  it("ends where it should, and means what it did", () => {
    const code = 'const a = "<!--", b = /<script\\b/i, c = "</script>";';
    const { text, ended } = parsed(code);
    expect(ended).toBe(true);
    // Still the same program: the escapes read as what they replaced.
    const [a, b, c] = new Function(`${text}; return [a, b, c];`)();
    expect([a, b.test("<SCRIPT src>"), c]).toEqual(["<!--", true, "</script>"]);
  });
});
