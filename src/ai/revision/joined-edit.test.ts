import { describe, expect, it } from "vitest";
import { editedText } from "./joined-edit";

const text =
  "The tide went out. Boats lay on the mud.\n\nAt dusk they came back.";

describe("an edit made in text proposed and not decided yet", () => {
  it("replaces and deletes inside it", () => {
    expect(
      editedText(text, {
        action: "replace",
        anchor: "Boats lay on the mud.",
        text: "Boats leaned in the mud.",
      }),
    ).toBe(
      "The tide went out. Boats leaned in the mud.\n\nAt dusk they came back.",
    );
    expect(
      editedText(text, { action: "delete", anchor: "At dusk they came back." }),
    ).toBe("The tide went out. Boats lay on the mud.");
  });

  it("adds words inside a paragraph, and a paragraph after one", () => {
    expect(
      editedText(text, {
        action: "insert_after",
        anchor: "The tide went out.",
        text: "Gulls followed it.",
      }),
    ).toBe(
      "The tide went out. Gulls followed it. Boats lay on the mud.\n\nAt dusk they came back.",
    );
    expect(
      editedText(text, {
        action: "insert_after",
        anchor: "Boats lay on the mud.",
        text: "Night came on.",
      }),
    ).toBe(
      "The tide went out. Boats lay on the mud.\n\nNight came on.\n\nAt dusk they came back.",
    );
    expect(
      editedText("潮水退了。", {
        action: "insert_after",
        anchor: "潮水退了。",
        text: "海鸥跟着飞走。",
      }),
    ).toBe("潮水退了。\n\n海鸥跟着飞走。");
  });

  it("is no edit for an anchor not there once, or one that isn't anchored", () => {
    expect(
      editedText(text, { action: "replace", anchor: "Rain.", text: "x" }),
    ).toBeNull();
    expect(
      editedText("A. A.", { action: "replace", anchor: "A.", text: "x" }),
    ).toBeNull();
    expect(editedText(text, { action: "append", text: "More." })).toBeNull();
  });
});
