import type { Ctx } from "@milkdown/kit/ctx";
import { reanchoredPicture } from "./joined-edit";
import { closeHistory } from "@milkdown/kit/prose/history";
import { editorViewCtx } from "@milkdown/kit/core";
import { visibleTextBetween } from "../../editor/markdown/link-reveal";
import { isAnchored, plainText, resolveAnchored } from "./pending-place";

import {
  composeMarkdownEdit,
  documentMarkdown,
  findMarkdownMatch,
  serializeBlocks,
} from "../doc-markdown";
import { applyEditRange, replaceWithMarkdown } from "./apply-edit";

import {
  citationsAsFootnotes,
  footnoteLabels,
  hasCitations,
  withoutCitations,
} from "../citations";

import { isIOSApp } from "../../platform/capabilities";
import {
  pendingEditKey,
  sentenceTake,
  type PendingPreview,
} from "./pending-edit-plugin";
import { composeSentences, trimBreaks } from "./sentence-diff";
import { findInOrder } from "./sentence-locate";

import type { CitationStyle } from "./usePendingEdits";

/** What an Accept did in the document: written, not yet (still
 *  streaming), or nothing written because every sentence was kept (a
 *  rejection) - and the preview it settled. */
export interface AcceptOutcome {
  ok: boolean;
  stillStreaming: boolean;
  rejectedAll: boolean;
  preview?: PendingPreview;
}

/**
 * Writes `callId`'s proposal into the document - the only path a reply
 * takes into it: the taken sentences, or `textOverride` (the card's
 * picker) composed against the target the preview resolved, its web
 * citations as footnotes or left out, in one transaction that is its own
 * undo step. Another proposal the edit unsettled is found again in the
 * new text. Side effects on the editor only; what was decided is the
 * caller's (pending-actions.ts).
 */
export function writeAccept(
  ctx: Ctx,
  callId: string,
  textOverride: string | undefined,
  citationStyle?: () => CitationStyle,
): AcceptOutcome {
  let ok = false;
  let stillStreaming = false;
  let rejectedAll = false;
  const settled: { preview?: PendingPreview } = {};
  const done = (): AcceptOutcome => ({
    ok,
    stillStreaming,
    rejectedAll,
    preview: settled.preview,
  });
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const before = pendingEditKey.getState(state)?.previews ?? [];
  const preview = before.find((p) => p.callId === callId);
  if (!preview) return done();
  // The arguments are still streaming in: `replacement` is incomplete,
  // so applying now would write a half-generated edit. Not a failure -
  // the status stays pending and the button works once the final add
  // (same callId, no flag) lands moments later.
  if (preview.streaming) {
    stillStreaming = true;
    return done();
  }
  // Defensive re-check mirroring the plugin's own staleness rule -
  // not expected to fire (the plugin already drops previews whose
  // mapped text changed), but a silent no-op here would be worse.
  if (
    visibleTextBetween(state.doc, preview.from, preview.to, " ") !==
    preview.expectedText
  )
    return done();

  settled.preview = preview;
  let replacement = preview.replacement;
  // Decided sentence by sentence (the ✓ / ✕ in the text or the
  // card): Accept writes the original with only the taken changes.
  const take = sentenceTake(preview);
  if (textOverride === undefined && preview.sentences && take) {
    if (!take.some(Boolean)) {
      // Every sentence kept: nothing to write - it is a rejection.
      view.dispatch(
        state.tr.setMeta(pendingEditKey, { type: "remove", callId }),
      );
      rejectedAll = true;
      return done();
    }
    if (!take.every(Boolean))
      textOverride = composeSentences(preview.sentences.hunks, take);
  }
  // Edited by the writer since it was proposed: each taken change in
  // its own place, back to front, and nothing else in the range -
  // composing the whole range would write their edits over.
  if (textOverride === undefined && preview.rebased && take) {
    const taken = preview.sentences!.changes.filter((_, i) => take[i]);
    let tr = state.tr;
    for (const c of [...taken].sort((a, b) => b.from - a.from))
      tr = replaceWithMarkdown(
        tr,
        ctx,
        c.from,
        c.to,
        withoutCitations(c.after).replace(/\s+$/, ""),
      );
    const landed = findInOrder(
      tr.doc,
      tr.mapping.map(preview.from, -1),
      tr.mapping.map(preview.to, 1),
      taken.map(
        ({ after }) =>
          plainText(ctx, trimBreaks(withoutCitations(after)))
            ?.replace(/\n/g, "")
            .trim() ?? "",
      ),
    );
    tr.setMeta(pendingEditKey, {
      type: "remove",
      callId,
      applied: true,
      landed,
    });
    closeHistory(tr);
    view.dispatch(tr.scrollIntoView());
    if (!isIOSApp) view.focus();
    ok = true;
    return done();
  }
  if (textOverride !== undefined) {
    const { proposal } = preview;
    if (
      proposal.action === "replace_selection" ||
      proposal.action === "append" ||
      proposal.action === "insert_at_cursor"
    ) {
      replacement = textOverride;
    } else {
      const match = findMarkdownMatch(
        serializeBlocks(ctx, state.doc),
        proposal.anchor ?? "",
        proposal.context,
      );
      if (!match) return done();
      replacement = composeMarkdownEdit(match, proposal.action, textOverride);
    }
  }
  // Web citations ([2](url)): footnotes at the end of the document,
  // or left out - the proposal card's "Add sources as footnotes".
  let footnotes: string[] = [];
  if (hasCitations(replacement)) {
    const cite = citationStyle?.();
    if (cite?.asFootnotes) {
      ({ text: replacement, definitions: footnotes } = citationsAsFootnotes(
        replacement,
        cite.sources,
        footnoteLabels(documentMarkdown(serializeBlocks(ctx, state.doc))),
      ));
    } else {
      replacement = withoutCitations(replacement);
    }
  }
  const tr = applyEditRange(
    state,
    ctx,
    preview.from,
    preview.to,
    replacement,
    footnotes,
  );
  // Same transaction: one undo step restores the document exactly,
  // and the decoration is gone the instant the edit lands (no orphan
  // frame where a stale preview paints over the just-applied text).
  // Where the new text now stands - the taken sentences only, for one
  // decided by sentence - so its green can fade out there rather than
  // vanish (the plugin's `landed`).
  const written =
    preview.sentences && take
      ? preview.sentences.changes.filter((_, i) => take[i])
      : [{ after: textOverride ?? preview.proposal.text ?? "" }];
  const landed = findInOrder(
    tr.doc,
    tr.mapping.map(preview.from, -1),
    tr.mapping.map(preview.to, 1),
    written.map(
      ({ after }) =>
        plainText(ctx, trimBreaks(withoutCitations(after)))
          ?.replace(/\n/g, "")
          .trim() ?? "",
    ),
  );
  tr.setMeta(pendingEditKey, {
    type: "remove",
    callId,
    applied: true,
    landed,
  });
  // Its own undo step, never merged with typing just before it: an
  // undo then lands exactly on the text it replaced, which is what
  // brings the proposal back (pending-edit-plugin's `applied`).
  closeHistory(tr);
  view.dispatch(tr.scrollIntoView());
  // A second proposal in the same paragraph resolved to the same whole
  // block, so this edit changed the text it was waiting on and the
  // plugin let it go ("Couldn't locate that text") although its own
  // words are still there. Find those again in the new text.
  const after = pendingEditKey.getState(view.state)?.previews ?? [];
  const lost = before.filter(
    (p) =>
      p.callId !== callId &&
      !p.streaming &&
      isAnchored(p.proposal) &&
      !after.some((a) => a.callId === p.callId),
  );
  if (lost.length > 0) {
    const doc = view.state.doc;
    const blocks = serializeBlocks(ctx, doc);
    const found: PendingPreview[] = [];
    for (const p of lost) {
      let proposal = p.proposal;
      let resolved = resolveAnchored(ctx, doc, blocks, proposal);
      // A picture after a paragraph this rewrite replaced, and left
      // out: by the new text's paragraph in the same place.
      const moved =
        !resolved && proposal.image
          ? reanchoredPicture(
              proposal,
              preview.proposal.anchor ?? "",
              textOverride ?? preview.proposal.text ?? "",
            )
          : null;
      if (moved) {
        proposal = moved;
        resolved = resolveAnchored(ctx, doc, blocks, proposal);
      }
      if (!resolved) continue;
      const { range, replacement: text, strikeRange } = resolved;
      found.push({
        ...p,
        proposal,
        from: range.from,
        to: range.to,
        expectedText: visibleTextBetween(doc, range.from, range.to, " "),
        replacement: text,
        strikeFrom: strikeRange?.from,
        strikeTo: strikeRange?.to,
        // Settled already: nothing streams in again.
        streamSource: undefined,
      });
    }
    if (found.length > 0)
      view.dispatch(
        view.state.tr.setMeta(pendingEditKey, {
          type: "add",
          previews: found,
        }),
      );
  }
  // On a phone, focusing the document raises the keyboard over the
  // AI sheet the Accept was tapped in, and what the user types next
  // lands in the document instead of the composer.
  if (!isIOSApp) view.focus();
  ok = true;
  return done();
}
