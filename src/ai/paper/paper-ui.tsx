import { useState } from "react";
import type { Strings } from "../../i18n/strings";
import { Select } from "../../ui/Select";
import { useSettings } from "../../prefs/SettingsContext";
import { OutlineCard } from "./OutlineCard";
import {
  paperActions,
  usePaperRun,
  type PaperCardInfo,
  type PaperRunState,
} from "./paper-store";
import "./outline-card.css";

/** The paper's lengths offered, in characters. */
export const PAPER_LENGTHS = [5000, 8000, 10000] as const;

/** One line of what the run is doing now. */
function progressLine(run: PaperRunState, t: Strings): string {
  const sections = run.outline?.sections.length ?? 0;
  const written = Object.values(run.sections).filter(
    (s) => s === "drafted" || s === "revising",
  ).length;
  switch (run.phase) {
    case "starting":
    case "planning":
      return t.paperPlanning;
    case "researching":
      return t.paperResearching
        .replace("{searches}", String(run.used?.searches ?? 0))
        .replace("{pages}", String(run.used?.fetches ?? 0))
        .replace("{papers}", String(run.used?.paperLookups ?? 0));
    case "outlining":
      return t.paperOutlining;
    case "awaitingOutline":
      return run.approving ? t.paperOutlineApproving : "";
    case "drafting":
      return t.paperDrafting
        .replace("{n}", String(written))
        .replace("{of}", String(sections));
    case "reviewing":
    case "illustrating":
      return t.paperReviewing;
    case "finishing":
      return t.paperFinishing;
    case "done":
      return run.proposed ? t.paperProposedCard : t.paperFinishing;
  }
}

/** A paper in the conversation: its progress, its outline to approve, then
 *  where its proposal went. */
export function PaperCard({ info }: { info: PaperCardInfo }) {
  const { t } = useSettings();
  const run = usePaperRun(info.key);
  const running =
    run &&
    !run.error &&
    !run.proposed &&
    (run.phase !== "awaitingOutline" || run.approving);
  const line = run ? progressLine(run, t) : t.paperEnded;
  return (
    <div className="paper-card">
      <div className="paper-card-head">
        <span className="paper-card-title">{t.paperCardTitle}</span>
        <span className="paper-card-topic">{info.topic}</span>
      </div>
      {run?.phase === "awaitingOutline" && run.outline && !run.error && (
        <OutlineCard
          outline={run.outline}
          unit={run.unit}
          busy={run.approving}
          t={t}
          onApprove={(outline) => paperActions()?.approve(info.key, outline)}
        />
      )}
      {run?.error ? (
        <p className="paper-card-error" role="alert">
          {run.error}
        </p>
      ) : (
        line && (
          <p className="paper-card-progress" aria-live="polite">
            {line}
          </p>
        )
      )}
      {running && (
        <div className="paper-card-actions">
          <button
            type="button"
            className="inline-chat-action"
            onClick={() => paperActions()?.stop(info.key)}
          >
            {t.paperStop}
          </button>
        </div>
      )}
    </div>
  );
}

/** What starting a paper asks: its topic and its length. */
export function PaperStart({
  t,
  onStart,
  onCancel,
}: {
  t: Strings;
  onStart: (topic: string, targetChars: number) => void;
  onCancel: () => void;
}) {
  const [topic, setTopic] = useState("");
  const [length, setLength] = useState<number>(PAPER_LENGTHS[1]);
  const lengthLabel = (n: number) =>
    n === PAPER_LENGTHS[0]
      ? t.paperLengthShort
      : n === PAPER_LENGTHS[1]
        ? t.paperLengthMedium
        : t.paperLengthLong;
  return (
    <form
      className="paper-card paper-start"
      onSubmit={(e) => {
        e.preventDefault();
        if (topic.trim()) onStart(topic.trim(), length);
      }}
    >
      <label className="paper-outline-field">
        <span>{t.paperTopic}</span>
        <textarea
          rows={3}
          autoFocus
          placeholder={t.paperTopicPlaceholder}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
      </label>
      <div className="paper-card-actions">
        <Select
          className="paper-outline-kind"
          aria-label={t.paperLength}
          value={String(length)}
          onChange={(e) => setLength(Number(e.target.value))}
        >
          {PAPER_LENGTHS.map((n) => (
            <option key={n} value={String(n)}>
              {lengthLabel(n)}
            </option>
          ))}
        </Select>
        <span className="paper-card-spacer" />
        <button type="button" className="inline-chat-action" onClick={onCancel}>
          {t.cancel}
        </button>
        <button
          type="submit"
          className="inline-chat-action inline-chat-action-primary"
          disabled={!topic.trim()}
        >
          {t.paperStart}
        </button>
      </div>
    </form>
  );
}
