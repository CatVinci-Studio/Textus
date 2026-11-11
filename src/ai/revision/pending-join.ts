import { editorViewCtx } from "@milkdown/kit/core";
import { editedText } from "./joined-edit";
import { placeProposals } from "./pending-place";
import { documentMarkdown, serializeBlocks } from "../doc-markdown";
import { pendingEditKey } from "./pending-edit-plugin";
import { recordStatuses } from "./proposal-lifecycle";
import { joinedText } from "./generated-images";
import type { EditProposal } from "../types";
import type { PendingEnv } from "./pending-actions";

/**
 * Proposals that become part of another: an edit or a picture anchored in
 * text still on offer is made in that proposal, and pictures a text now
 * carries give up their own. Each reads as joined in its card.
 */
export function makeProposalJoins(
  env: Pick<PendingEnv, "run" | "setStatuses">,
) {
  /** `callId`'s edit made in the undecided proposal whose text holds
   *  `anchor`; `rewrite` gives that text edited, or null if it doesn't fit. */
  const joinInto = (
    callId: string,
    anchor: string,
    rewrite: (text: string) => string | null,
  ): boolean => {
    let joined = false;
    env.run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const inDocument = documentMarkdown(
        serializeBlocks(ctx, state.doc),
      ).includes(anchor);
      const previews = pendingEditKey.getState(state)?.previews ?? [];
      for (const host of previews) {
        if (host.streaming || host.proposal.image || host.callId === callId)
          continue;
        // Document text this rewrite replaces is its text now, as the user
        // sees it.
        const replaces =
          host.proposal.action === "replace" &&
          (host.proposal.anchor ?? "").includes(anchor);
        if (inDocument && !replaces) continue;
        const old = host.proposal.text ?? "";
        const text = rewrite(old);
        if (text === null || !host.replacement.includes(old)) continue;
        // Placed again, so its sentence-by-sentence view is of the new text.
        const proposal = { ...host.proposal, text };
        const [placed] = placeProposals(
          ctx,
          state,
          [{ callId: host.callId, proposal }],
          null,
        ).placed;
        view.dispatch(
          state.tr.setMeta(pendingEditKey, {
            type: "add",
            previews: [
              {
                ...host,
                ...(placed ?? {
                  proposal,
                  replacement: host.replacement.replace(old, () => text),
                  sentences: undefined,
                }),
                revision: (host.revision ?? 0) + 1,
              },
            ],
          }),
        );
        joined = true;
        return;
      }
    });
    if (joined)
      env.setStatuses((prev) =>
        recordStatuses(prev, [callId], {
          type: "decided",
          outcome: "joined",
        }),
      );
    return joined;
  };

  /** A picture anchored in undecided proposed text, put into that proposal
   *  on a line of its own. False when there's none: it stands alone. */
  const joinPicture = (callId: string, picture: EditProposal): boolean => {
    const { anchor, action } = picture;
    if (
      !picture.image ||
      !anchor ||
      (action !== "insert_after" && action !== "insert_before")
    )
      return false;
    return joinInto(callId, anchor, (text) =>
      joinedText(text, anchor, action, picture.text ?? ""),
    );
  };

  /** Pictures a text proposal now carries give up their own proposals, as
   *  joined; the picture goes on in the text. */
  const withdrawPictures = (ids: Set<string>, carriers: Set<string>) => {
    const gone: string[] = [];
    env.run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const previews = pendingEditKey.getState(view.state)?.previews ?? [];
      for (const p of previews)
        if (
          p.proposal.image &&
          ids.has(p.proposal.image.id) &&
          !carriers.has(p.callId)
        )
          gone.push(p.callId);
      // One step each: a meta set twice keeps only the last.
      for (const callId of gone)
        view.dispatch(
          view.state.tr.setMeta(pendingEditKey, { type: "remove", callId }),
        );
    });
    if (gone.length > 0)
      env.setStatuses((prev) =>
        recordStatuses(prev, gone, { type: "decided", outcome: "joined" }),
      );
  };

  /** A text edit anchored in an undecided proposal, made in that proposal
   *  rather than shown with nowhere to go. */
  const joinEdit = (callId: string, edit: EditProposal): boolean => {
    if (edit.image || !edit.anchor) return false;
    return joinInto(callId, edit.anchor, (text) => editedText(text, edit));
  };

  return { joinPicture, withdrawPictures, joinEdit };
}
