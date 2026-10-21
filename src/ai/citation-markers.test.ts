import { describe, expect, it } from "vitest";
import { withoutCitationMarkers } from "./citation-markers";

describe("withoutCitationMarkers", () => {
  it("takes out markers, delimited or bare", () => {
    expect(
      withoutCitationMarkers(
        "返回选项及概率。\ue200cite\ue202turn3view0\ue201",
      ),
    ).toBe("返回选项及概率。");
    expect(
      withoutCitationMarkers("多语言版。citeturn2search0turn3view2\n\nNext"),
    ).toBe("多语言版。\n\nNext");
    expect(withoutCitationMarkers("found it citeturn1view0.")).toBe(
      "found it.",
    );
    expect(withoutCitationMarkers("We cite turnout data.")).toBe(
      "We cite turnout data.",
    );
  });

  it("hides a marker that has only begun to arrive", () => {
    expect(withoutCitationMarkers("概率。citetur", true)).toBe("概率。");
    expect(withoutCitationMarkers("概率。\ue200cite\ue202tu", true)).toBe(
      "概率。",
    );
    // A word that merely ends in "c" stays.
    expect(withoutCitationMarkers("the topic", true)).toBe("the topic");
  });
});
