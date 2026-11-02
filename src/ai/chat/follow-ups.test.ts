import { describe, expect, it } from "vitest";
import { followUps } from "./follow-ups";

describe("followUps", () => {
  it("keeps up to three different messages, in order", () => {
    expect(
      followUps([
        " Shorten this section ",
        "",
        "shorten this section",
        "Add a summary at the top",
        "Fix the title",
        "Translate it",
      ]),
    ).toEqual([
      "Shorten this section",
      "Add a summary at the top",
      "Fix the title",
    ]);
  });

  it("reads anything but a list of text as none", () => {
    expect(followUps(null)).toEqual([]);
    expect(followUps("Shorten this section")).toEqual([]);
    expect(followUps([42, null, "缩短这一节"])).toEqual(["缩短这一节"]);
  });
});
