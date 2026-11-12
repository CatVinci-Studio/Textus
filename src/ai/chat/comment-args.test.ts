import { describe, expect, it } from "vitest";
import { commentCalls } from "./comment-args";

describe("add_comment calls", () => {
  it("reads add_comment calls, skipping ones still streaming", () => {
    expect(
      commentCalls([
        { kind: "User", text: "x" } as never,
        {
          kind: "ToolCall",
          name: "add_comment",
          call_id: "a",
          // A blank suggestion is no suggestion.
          arguments: JSON.stringify({
            anchor: "One",
            comment: "Why?",
            suggestion: "  ",
          }),
        },
        {
          kind: "ToolCall",
          name: "add_comment",
          call_id: "b",
          arguments: '{"anchor": "Tw',
        },
        {
          kind: "ToolCall",
          name: "propose_edit",
          call_id: "c",
          arguments: "{}",
        },
      ]),
    ).toEqual([{ id: "a", anchor: "One", comment: "Why?" }]);
  });
});
