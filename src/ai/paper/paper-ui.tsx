import { useEffect, useState } from "react";
import type { Strings } from "../../i18n/strings";
import { Select } from "../../ui/Select";
import { useSettings } from "../../prefs/SettingsContext";
import { OutlineCard } from "./OutlineCard";
import type {
  ActivityKind,
  SectionStatus,
} from "../../platform/bindings/ai-paper";
import {
  paperActions,
  usePaperRun,
  type PaperCardInfo,
  type PaperRunState,
  type QuestionState,
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

/** Seconds since `since`, as m:ss, ticking once a second while `on`. */
function useElapsed(since: number, on: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [on, since]);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function activityLabel(kind: ActivityKind, t: Strings): string {
  switch (kind) {
    case "search":
      return t.paperActivitySearch;
    case "read":
      return t.paperActivityRead;
    case "papers":
      return t.paperActivityPapers;
    case "library":
      return t.paperActivityLibrary;
    case "note":
      return t.paperActivityNote;
  }
}

function questionStatus(q: QuestionState, t: Strings): string {
  switch (q.state) {
    case "waiting":
      return t.paperQuestionWaiting;
    case "failed":
      return t.paperQuestionFailed;
    case "active":
    case "done":
      return q.state === "active" && q.notes === 0
        ? t.paperQuestionActive
        : t.paperQuestionNotes.replace("{n}", String(q.notes));
  }
}

function sectionStatus(status: SectionStatus, t: Strings): string {
  switch (status) {
    case "waiting":
      return t.paperSectionWaiting;
    case "drafting":
      return t.paperSectionDrafting;
    case "drafted":
    case "proposed":
      return t.paperSectionDrafted;
    case "revising":
      return t.paperSectionRevising;
    case "failed":
      return t.paperSectionFailed;
  }
}

/** What the run is doing in detail: the planner's thoughts, the questions
 *  and the helpers' latest steps, or each section's state. */
function PaperActivityView({ run, t }: { run: PaperRunState; t: Strings }) {
  if (run.phase === "starting" || run.phase === "planning") {
    return run.thinking ? (
      <p className="paper-card-thinking">{run.thinking}</p>
    ) : null;
  }
  if (run.phase === "researching") {
    return (
      <>
        {run.questions.length > 0 && (
          <ol className="paper-card-list" aria-label={t.paperQuestionsTitle}>
            {run.questions.map((q, i) => (
              <li key={i} className="paper-card-item" data-state={q.state}>
                <span className="paper-card-item-text">{q.text}</span>
                <span className="paper-card-item-status">
                  {questionStatus(q, t)}
                </span>
              </li>
            ))}
          </ol>
        )}
        {run.recent.length > 0 && (
          <ul className="paper-card-recent">
            {run.recent.map((a) => (
              <li key={a.id}>
                <span className="paper-card-recent-kind">
                  {activityLabel(a.kind, t)}
                </span>
                <span className="paper-card-recent-detail">{a.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  if ((run.phase === "drafting" || run.phase === "reviewing") && run.outline) {
    return (
      <ol className="paper-card-list">
        {run.outline.sections.map((section, i) => {
          const status = run.sections[i] ?? "waiting";
          return (
            <li key={i} className="paper-card-item" data-state={status}>
              <span className="paper-card-item-text">{section.title}</span>
              <span className="paper-card-item-status">
                {sectionStatus(status, t)}
              </span>
            </li>
          );
        })}
      </ol>
    );
  }
  return null;
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
  const busy = Boolean(running) && run?.phase !== "awaitingOutline";
  const elapsed = useElapsed(run?.phaseSince ?? 0, busy);
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
          <p className="paper-card-progress">
            <span aria-live="polite">{line}</span>
            {busy && <span className="paper-card-elapsed">{elapsed}</span>}
          </p>
        )
      )}
      {run && busy && <PaperActivityView run={run} t={t} />}
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
