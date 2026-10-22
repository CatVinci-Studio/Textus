import {
  resolveBlockEdit,
  resolveBlockTarget,
  type SentBlock,
} from "../ai/doc-blocks";

/**
 * The dev shim's stand-in for the backend's step settling (agent/settle.rs)
 * - for e2e, whose scripted model writes a call as the words it is about.
 * A real model names the block those words are in (`block`); here the one
 * block that holds them is named for it, and then what the block says is
 * filled in as doc_blocks.rs does. Words in no block (text proposed and
 * not decided yet) stay a quote, as they do from a real model.
 */

const PLACED_CALLS = new Set(["propose_edit", "add_comment", "generate_image"]);

/** `args` as the model would send them: with the block its words are in,
 *  or the run of blocks they cross (`block` to `last_block`), written
 *  first - as the schema orders them, and as a streaming draft needs. */
export function namedCall(
  blocks: readonly SentBlock[],
  args: Record<string, unknown>,
): Record<string, unknown> {
  const anchor = typeof args.anchor === "string" ? args.anchor : "";
  // `block: null`: the scripted model quotes text proposed and not decided
  // yet, which has no block - left a quote.
  if (args.block === null) {
    const quote = { ...args };
    delete quote.block;
    return quote;
  }
  if (args.block || !anchor) return args;
  const named = (block: string, lastBlock?: string) => {
    const { action, ...rest } = args;
    return {
      action,
      block,
      ...(lastBlock ? { last_block: lastBlock } : {}),
      ...rest,
    };
  };
  const holding = blocks.filter((b) => b.markdown.includes(anchor));
  if (holding.length === 1) return named(holding[0].id);
  if (holding.length > 1) return args;
  // Across blocks: where it starts and ends in their markdown joined.
  const document = blocks.map((b) => b.markdown).join("\n\n");
  const at = document.indexOf(anchor);
  if (at === -1 || document.indexOf(anchor, at + 1) !== -1) return args;
  let offset = 0;
  let first = -1;
  let last = -1;
  blocks.forEach((b, i) => {
    const end = offset + b.markdown.length;
    if (first === -1 && at < end) first = i;
    if (at + anchor.length > offset) last = i;
    offset = end + 2;
  });
  return named(blocks[first].id, last > first ? blocks[last].id : undefined);
}

/** A call's arguments as the backend hands them on: named (namedCall),
 *  then resolved. */
export function settledArguments(
  blocks: readonly SentBlock[],
  name: string,
  argumentsJson: string,
): string {
  if (!PLACED_CALLS.has(name)) return argumentsJson;
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argumentsJson);
  } catch {
    return argumentsJson;
  }
  const named = namedCall(blocks, args);
  if (typeof named.block !== "string") return JSON.stringify(named);
  const anchor = typeof named.anchor === "string" ? named.anchor : undefined;
  if (name === "propose_edit") {
    const resolved = resolveBlockEdit(
      blocks,
      {
        action: String(named.action ?? ""),
        block: named.block,
        lastBlock:
          typeof named.last_block === "string" ? named.last_block : undefined,
        anchor,
        text: typeof named.text === "string" ? named.text : "",
      },
      true,
    );
    if (!resolved) return JSON.stringify(named);
    const { lastBlock, ...rest } = resolved;
    return JSON.stringify({
      ...named,
      ...rest,
      ...(lastBlock ? { last_block: lastBlock } : {}),
    });
  }
  const target = resolveBlockTarget(blocks, { block: named.block, anchor });
  return JSON.stringify(target ? { ...named, ...target } : named);
}

/** Turns a canned reply carries, their placed calls settled. */
export function settledTurns(
  blocks: readonly SentBlock[],
  turns: unknown,
): unknown {
  if (!Array.isArray(turns)) return turns;
  return turns.map((turn) =>
    turn &&
    typeof turn === "object" &&
    (turn as { kind?: string }).kind === "ToolCall"
      ? {
          ...turn,
          arguments: settledArguments(
            blocks,
            String((turn as { name?: string }).name ?? ""),
            String((turn as { arguments?: string }).arguments ?? ""),
          ),
        }
      : turn,
  );
}
