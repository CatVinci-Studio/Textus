import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { usePicturesState } from "../revision/usePicturesState";
import type { EditProposal } from "../types";
import type { PendingStatus } from "../revision/usePendingEdits";
import { hasCitations } from "../citations";
import { useSettings } from "../../settings/SettingsContext";
import { diffLines } from "./line-diff";
import type { PendingSentence } from "../revision/pending-edit-plugin";
import {
  generatedImageFailure,
  loadGeneratedImage,
  generatedImageRatio,
  generatedImageUrl,
  onPictureSettled,
} from "../revision/generated-images";
import { Tooltip } from "../../ui/Tooltip";
import type { ChatMessagesLabels } from "./ChatMessages";
import { InlineMarkdownText } from "../MarkdownText";
import { blockSummary, type BlockNames } from "../revision/markdown-forms";
import { inlineSentence } from "../revision/sentence-diff";

export const CHECK = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);
export const CROSS = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

/** What the user is told of a generate_image call that made no picture.
 *  Null for a call the model got wrong and sends again: the model's to fix. */
export function notMadeLine(
  argumentsJson: string,
  labels: { imageLimitReached: string; imageNoModel: string },
): string | null {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argumentsJson);
  } catch {
    return null;
  }
  if (typeof args.limit_reached === "number")
    return labels.imageLimitReached.replace("{n}", String(args.limit_reached));
  if (args.not_generated === undefined && args.image === undefined)
    return labels.imageNoModel;
  return null;
}

/** A proposed picture on its card, small: its frame while it is made,
 *  then the picture, or why it wasn't made. */
export function ProposedPicture({ id, alt }: { id: string; alt: string }) {
  // Read again whenever a picture comes or goes: one redrawn in the
  // document paints here too until the new one has come.
  const url = useSyncExternalStore(onPictureSettled, () =>
    generatedImageUrl(id),
  );
  const failure = useSyncExternalStore(onPictureSettled, () =>
    generatedImageFailure(id),
  );
  useEffect(() => {
    if (!url && !failure) void loadGeneratedImage(id);
  }, [id, url, failure]);
  if (url)
    return <img className="agent-proposal-picture" src={url} alt={alt} />;
  if (failure)
    return <span className="agent-proposal-picture-failed">{failure}</span>;
  return (
    <span
      className="pending-picture agent-proposal-picture-frame"
      role="img"
      aria-busy="true"
      aria-label={alt}
      style={{ aspectRatio: generatedImageRatio(id) }}
    >
      <span className="pending-picture-blob" />
      <span className="pending-picture-blob" />
      <span className="pending-picture-blob" />
    </span>
  );
}

/**
 * One propose_edit call: its kind and size, the model's reason, and controls.
 * Its ✓ / ✕ mirror the document's. The line diff opens only when `invalid`,
 * since an anchor that can't be located leaves no in-document preview.
 */
export function ProposalCard({
  callId,
  proposal,
  status,
  reveal,
  style,
  selectedText,
  labels,
  sentences,
  onDecide,
  onReveal,
  onAccept,
  onReject,
  onRelocate,
  actions = true,
}: {
  callId: string;
  proposal: EditProposal;
  status: PendingStatus;
  reveal: boolean;
  style: CSSProperties | undefined;
  selectedText: string | null;
  labels: ChatMessagesLabels;
  sentences: PendingSentence[] | null;
  onDecide?: (callId: string, index: number, take: boolean | null) => void;
  onReveal?: (callId: string, index: number) => void;
  onAccept: (callId: string, text?: string) => void;
  onReject: (callId: string) => void;
  onRelocate: (proposal: EditProposal) => void;
  actions?: boolean;
}) {
  const [diffOpen, setDiffOpen] = useState(status === "invalid");
  // Its pictures: Accept waits while one is being made, and a picture on
  // its own that wasn't made has nothing to accept.
  const pictures = usePicturesState(proposal.text ?? "");
  const nothingToAccept = !!proposal.image && pictures === "failed";
  // The proposal cites the web: Accept writes the sources as footnotes, or
  // leaves them out - the last card's choice stands.
  const { settings, setSettings } = useSettings();
  // A proposal that turns invalid after mounting (its preview resolved and
  // failed) must pop open - the card just became the only view of it.
  useEffect(() => {
    if (status === "invalid") setDiffOpen(true);
  }, [status]);

  // `append` has nothing to compare against; the others diff the text they
  // target against the replacement. replace_selection targets the captured
  // selection rather than a quoted anchor.
  const before =
    proposal.action === "append"
      ? ""
      : proposal.action === "replace_selection"
        ? (selectedText ?? "")
        : (proposal.anchor ?? "");
  const after =
    proposal.action === "delete"
      ? ""
      : proposal.action === "insert_before"
        ? `${proposal.text ?? ""}\n${before}`
        : proposal.action === "insert_after"
          ? `${before}\n${proposal.text ?? ""}`
          : (proposal.text ?? "");
  // Memoized because this re-renders on every streaming delta while a later
  // turn is still arriving, and the LCS diff is up to 400x400 lines.
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const added = lines.filter((line) => line.kind === "add").length;
  const removed = lines.filter((line) => line.kind === "remove").length;

  const taken = sentences?.filter((s) => s.take !== false).length ?? 0;
  const partial = !!sentences && taken < sentences.length;

  return (
    <div
      className={`agent-proposal${reveal ? " turn-reveal" : ""}`}
      data-status={status}
      style={style}
    >
      <div className="agent-proposal-head">
        <span className="agent-proposal-icon" aria-hidden="true">
          {CHECK}
        </span>
        <span className="agent-proposal-title">
          {labels.proposalTitle}
          <span className="agent-proposal-kind">
            {" · "}
            {proposal.image
              ? labels.proposalImage
              : sentences && sentences.length > 1
                ? labels.proposalChangeCount.replace(
                    "{n}",
                    String(sentences.length),
                  )
                : labels.actionNames[proposal.action]}
          </span>
        </span>
        {/* Listed sentence by sentence below, the size chips would only
            crowd the head. */}
        {!(sentences && sentences.length > 1) && !proposal.image && (
          <Tooltip text={diffOpen ? labels.diffCollapse : labels.diffShow}>
            <button
              type="button"
              className="agent-diff-summary"
              aria-expanded={diffOpen}
              onClick={() => setDiffOpen(!diffOpen)}
            >
              {added > 0 && (
                <span className="agent-diff-chip agent-diff-add">+{added}</span>
              )}
              {removed > 0 && (
                <span className="agent-diff-chip agent-diff-remove">
                  {"\u2212"}
                  {removed}
                </span>
              )}
              <span className="agent-diff-caret" aria-hidden="true" />
            </button>
          </Tooltip>
        )}
        {status === "pending" && onReveal && (
          <button
            type="button"
            className="agent-proposal-link agent-proposal-show"
            onClick={() => onReveal(callId, -1)}
          >
            {labels.proposalShowInText}
          </button>
        )}
      </div>
      {proposal.reason && (
        <div className="agent-proposal-reason">{proposal.reason}</div>
      )}
      {proposal.image && status !== "rejected" && (
        <ProposedPicture id={proposal.image.id} alt={proposal.image.alt} />
      )}
      {diffOpen && (
        <div className="agent-proposal-diff">
          {lines.map((line, i) => (
            <div key={i} className={`agent-diff-line agent-diff-${line.kind}`}>
              <span className="agent-diff-marker" aria-hidden="true">
                {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
              </span>
              <span className="agent-diff-text">{line.text || "\u00a0"}</span>
            </div>
          ))}
        </div>
      )}
      {sentences && sentences.length > 1 && (
        <ol className="agent-proposal-sentences">
          {sentences.map((s, k) => {
            const state =
              s.take === false ? "kept" : s.take === true ? "taken" : "open";
            return (
              <li key={k} data-state={state}>
                <button
                  type="button"
                  className="agent-proposal-sentence"
                  onClick={() => onReveal?.(callId, k)}
                >
                  <span className="agent-proposal-num">{k + 1}</span>
                  <span className="agent-proposal-sentence-text">
                    <ChangeText
                      markdown={
                        (state === "kept" ? s.before : s.after).trim() ||
                        s.before
                      }
                      names={labels.proposalBlocks}
                    />
                  </span>
                </button>
                {actions && onDecide && (
                  <span className="agent-proposal-pick">
                    <Tooltip text={labels.proposalTakeSentence}>
                      <button
                        type="button"
                        className="pending-pick-take"
                        aria-pressed={s.take === true}
                        aria-label={labels.proposalTakeSentence}
                        onClick={() =>
                          onDecide(callId, k, s.take === true ? null : true)
                        }
                      >
                        {CHECK}
                      </button>
                    </Tooltip>
                    <Tooltip text={labels.proposalKeepSentence}>
                      <button
                        type="button"
                        className="pending-pick-keep"
                        aria-pressed={s.take === false}
                        aria-label={labels.proposalKeepSentence}
                        onClick={() =>
                          onDecide(callId, k, s.take === false ? null : false)
                        }
                      >
                        {CROSS}
                      </button>
                    </Tooltip>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {status === "pending" && hasCitations(proposal.text ?? "") && (
        <label className="agent-proposal-footnotes">
          <input
            type="checkbox"
            className="ui-check"
            checked={settings.sourcesAsFootnotes}
            onChange={(e) =>
              setSettings({ sourcesAsFootnotes: e.target.checked })
            }
          />
          {labels.proposalSourcesAsFootnotes}
        </label>
      )}
      {status === "pending" ? (
        actions && (
          <div className="agent-proposal-actions">
            {!nothingToAccept && (
              <button
                className="inline-chat-action inline-chat-action-primary"
                disabled={pictures === "painting"}
                onClick={() => onAccept(callId)}
              >
                {pictures === "painting"
                  ? labels.proposalPicturePainting
                  : partial && sentences
                    ? labels.proposalAcceptSome
                        .replace("{k}", String(taken))
                        .replace("{n}", String(sentences.length))
                    : labels.proposalAccept}
              </button>
            )}
            <button
              className="inline-chat-action"
              onClick={() => onReject(callId)}
            >
              {labels.proposalReject}
            </button>
          </div>
        )
      ) : status === "invalid" ? (
        // The anchor no longer resolves to exactly one place: nothing to
        // preview, nothing safe to write. Ask the model again instead.
        <>
          <div className="agent-proposal-status agent-proposal-status-invalid">
            {labels.proposalStatus.invalid}
          </div>
          {/* A picture's place can't be asked for again: its text is the
              picture's placeholder, not words the model wrote. */}
          {!proposal.image && (
            <button
              className="inline-chat-action"
              onClick={() => onRelocate(proposal)}
            >
              {labels.proposalRelocate}
            </button>
          )}
        </>
      ) : (
        <div
          className={`agent-proposal-status agent-proposal-status-${status}`}
        >
          {labels.proposalStatus[status]}
        </div>
      )}
    </div>
  );
}

/** One change's text on the card, drawn as the document draws it; a whole
 *  block (a table, a picture) by what it is. */
export function ChangeText({
  markdown,
  names,
}: {
  markdown: string;
  names: BlockNames;
}) {
  return (
    <InlineMarkdownText
      text={blockSummary(markdown, names) ?? inlineSentence(markdown)}
    />
  );
}
