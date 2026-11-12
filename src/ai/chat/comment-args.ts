/** One of a reply's comments: an add_comment call's arguments. */
export interface Comment {
  anchor: string;
  comment: string;
  block?: string;
  /** The passage (`anchor`, or the whole block) as it would read fixed:
   *  one click makes it a proposal. */
  suggestion?: string;
}

/** An add_comment call's arguments, or null while they aren't whole JSON
 *  (still streaming in) or lack the anchor and the comment. */
export function parseComment(argumentsJson: string): Comment | null {
  try {
    const parsed = JSON.parse(argumentsJson);
    if (typeof parsed.anchor !== "string" || typeof parsed.comment !== "string")
      return null;
    return {
      anchor: parsed.anchor,
      comment: parsed.comment,
      block: typeof parsed.block === "string" ? parsed.block : undefined,
      suggestion:
        typeof parsed.suggestion === "string" && parsed.suggestion.trim()
          ? parsed.suggestion
          : undefined,
    };
  } catch {
    return null;
  }
}

/** The add_comment calls in a conversation's turns, in order. */
export function commentCalls(
  turns: readonly {
    kind: string;
    name?: string;
    call_id?: string;
    arguments?: string;
  }[],
): ({ id: string } & Comment)[] {
  return turns.flatMap((turn) => {
    if (turn.kind !== "ToolCall" || turn.name !== "add_comment") return [];
    const comment = turn.call_id && parseComment(turn.arguments ?? "");
    return comment ? [{ id: turn.call_id!, ...comment }] : [];
  });
}
