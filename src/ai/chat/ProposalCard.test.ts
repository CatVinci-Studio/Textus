import { describe, expect, it } from "vitest";
import { notMadeLine } from "./ProposalCard";

const labels = { imageLimitReached: "limit {n}", imageNoModel: "no model" };

describe("notMadeLine", () => {
  it("names the request's limit when it was reached", () => {
    expect(
      notMadeLine(
        JSON.stringify({ not_generated: "x", limit_reached: 2 }),
        labels,
      ),
    ).toBe("limit 2");
  });

  it("says no model is set up when the call came back empty", () => {
    expect(notMadeLine(JSON.stringify({ prompt: "a harbour" }), labels)).toBe(
      "no model",
    );
  });

  it("says nothing of a call the model got wrong, or of one that made a picture", () => {
    const wrong = {
      not_generated: "`prompt` is empty - describe the picture.",
    };
    expect(notMadeLine(JSON.stringify(wrong), labels)).toBeNull();
    expect(notMadeLine(JSON.stringify({ image: "a.png" }), labels)).toBeNull();
    expect(notMadeLine("{not json", labels)).toBeNull();
  });
});
