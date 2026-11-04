// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { rewrite, sourceSegments } from "./html-text-edit";

describe("editing an HTML block's words", () => {
  const source =
    '<table>\n  <tr><th width="50%">Q &amp; A</th></tr>\n  <!-- note -->\n  <tr><td><img src="a.png"> caption</td></tr>\n</table>';

  it("finds each run of words between tags, decoded, and not comments", () => {
    expect(sourceSegments(source).map((s) => s.text)).toEqual([
      "Q & A",
      "caption",
    ]);
  });

  it("writes new words between the same tags, escaped", () => {
    const segments = sourceSegments(source);
    expect(rewrite(source, segments, ["Q & A", "a <new> caption"])).toBe(
      source.replace(" caption<", " a &lt;new&gt; caption<"),
    );
    expect(rewrite(source, segments, ["Q & A", "caption"])).toBeNull();
  });
});
