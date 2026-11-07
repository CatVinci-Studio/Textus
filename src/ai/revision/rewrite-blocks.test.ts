// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { editorViewCtx } from "@milkdown/kit/core";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { cachedDocument } from "../doc-markdown";
import { resolveBlockEdit } from "../doc-blocks";
import { placeProposals } from "./pending-place";
import { reviewChanges } from "./pending-types";
import CASES from "./rewrite-blocks-cases.json";

/** A whole-document rewrite around a non-sentence block is still decided
 *  paragraph by paragraph; a block written another way is no change. */

// Long enough on both sides not to be merged as short paragraphs.
const BEFORE =
  "小满撑开伞，仔细看过伞面和竹骨，都好好的。她又把伞收起来，在手里掂了掂，伞柄上的漆早就磨掉了，露出底下发黑的木头，摸上去却还是光滑的，像被很多只手握过很多年，一直没有换过。";
const AFTER =
  "雨停了，她把伞挂在门后。门后的钉子上原本挂着一件旧雨衣，她把雨衣取下来叠好放进柜子，让伞单独挂在那里，伞尖还在往下滴水，一滴一滴落在门口那块褪了色的旧地垫上，过了很久很久才终于停下来。";
const NEW_BEFORE =
  "Xiaoman opened the umbrella and checked the canopy and ribs.";
const NEW_AFTER =
  "The rain stopped, and she hung the umbrella behind the door.";

/** The rows the proposal's card lists: one per part to decide. */
async function rowsFor(block: string, rewritten: string): Promise<number> {
  const editor = await createTestEditor(`${BEFORE}\n\n${block}\n\n${AFTER}\n`);
  try {
    return editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { blocks } = cachedDocument(ctx, view.state.doc);
      const text = `${NEW_BEFORE}\n\n${rewritten}\n\n${NEW_AFTER}`;
      const edit = resolveBlockEdit(
        blocks,
        {
          action: "replace",
          block: blocks[0].id,
          lastBlock: blocks.at(-1)!.id,
          text,
        },
        true,
      )!;
      const { placed } = placeProposals(
        ctx,
        view.state,
        [{ callId: "r1", proposal: { ...edit, action: "replace" } }],
        null,
      );
      const changes = reviewChanges(placed[0]) ?? [];
      return changes.length > 1 ? changes.length : 0;
    });
  } finally {
    await editor.destroy();
  }
}

describe("a whole rewrite around another kind of block", () => {
  it.each(CASES)("around $name is decided by its parts", async (c) => {
    expect(await rowsFor(c.block, c.rewritten)).toBe(c.changes);
  });
});
