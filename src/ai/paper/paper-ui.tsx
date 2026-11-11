import { explainAiError } from "../error-messages";
import { fill } from "../../i18n/fill";
import { useEffect, useState } from "react";
import { plural, type Lang, type Strings } from "../../i18n/strings";
import { useSettings } from "../../prefs/SettingsContext";
import { OutlineCard } from "./OutlineCard";
import type { SectionStatus } from "../../platform/bindings/ai-paper";
import {
  paperActions,
  restorePaperCard,
  usePaperRun,
  type PaperCardInfo,
  type PaperRunState,
  type QuestionState,
} from "./paper-store";
import { genreLabel } from "./paper-genres";
import { citationOrder } from "./paper-document";
import "./outline-card.css";
import { toolActivityLabels, toolActivityText } from "../chat/tool-activity";

/** How much of the work at hand is under way at once, and how much done:
 *  the questions while researching, the sections while drafting and
 *  reviewing. Null in the other phases, or before there is a list. */
export interface PaperConcurrency {
  of: "questions" | "sections";
  active: number;
  done: number;
  total: number;
}

export function paperConcurrency(run: PaperRunState): PaperConcurrency | null {
  if (run.phase === "researching") {
    const total = run.questions.length;
    if (total === 0) return null;
    let active = 0;
    let done = 0;
    for (const q of run.questions) {
      if (q.state === "active") active++;
      else if (q.state === "done" || q.state === "failed") done++;
    }
    return { of: "questions", active, done, total };
  }
  if (run.phase === "drafting" || run.phase === "reviewing") {
    const total = run.outline?.sections.length ?? 0;
    if (total === 0) return null;
    let active = 0;
    let done = 0;
    // Keyed by index, so sections finishing out of order count the same;
    // an index past the outline (one edited shorter) counts for nothing.
    for (const [index, status] of Object.entries(run.sections)) {
      if (Number(index) >= total) continue;
      if (status === "drafted") done++;
      else active++;
    }
    return { of: "sections", active, done, total };
  }
  return null;
}

/** The concurrency as the card words it: how many at once when more than
 *  one, else only how many are done. */
export function concurrencyLine(
  c: PaperConcurrency,
  phase: PaperRunState["phase"],
  t: Strings,
  lang: Lang,
): string {
  const forms =
    c.of === "questions"
      ? t.paperQuestionsAtOnce
      : phase === "reviewing"
        ? t.paperRevisingAtOnce
        : t.paperSectionsAtOnce;
  const text = c.active > 1 ? plural(forms, c.active, lang) : t.paperDoneOf;
  return fill(text, { done: String(c.done), of: String(c.total) });
}

/** One line of what the run is doing now. */
function progressLine(run: PaperRunState, t: Strings, lang: Lang): string {
  if (run.paused) return t.paperPaused;
  switch (run.phase) {
    case "starting":
    case "planning":
      return t.paperPlanning;
    case "researching":
      return fill(t.paperResearching, {
        searches: String(run.used?.searches ?? 0),
        pages: String(run.used?.fetches ?? 0),
        papers: String(run.used?.paperLookups ?? 0),
      });
    case "outlining":
      return t.paperOutlining;
    case "awaitingOutline":
      return run.approving ? t.paperOutlineApproving : "";
    case "drafting": {
      const c = paperConcurrency(run);
      if (c && c.active > 1) return concurrencyLine(c, run.phase, t, lang);
      return fill(t.paperDrafting, {
        n: String(c?.done ?? 0),
        of: String(c?.total ?? 0),
      });
    }
    case "reviewing":
      return t.paperReviewing;
    case "finishing":
      return t.paperFinishing;
    case "done":
      if (!run.written) return t.paperFinishing;
      return run.picturesLeft > 0
        ? fill(t.paperAddingPictures, { n: String(run.picturesLeft) })
        : t.paperWrittenCard;
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
        : fill(t.paperQuestionNotes, { n: String(q.notes) });
  }
}

/** A section's state on the card: as the run last said, or waiting for
 *  its writer. */
function sectionStatus(status: SectionStatus | "waiting", t: Strings): string {
  switch (status) {
    case "waiting":
      return t.paperSectionWaiting;
    case "drafting":
      return t.paperSectionDrafting;
    case "drafted":
      return t.paperSectionDrafted;
    case "revising":
      return t.paperSectionRevising;
  }
}

/** How much of a section the card shows as it is written: its last words;
 *  the document has the whole. */
const PREVIEW_TAIL = 600;

/** A section's text as the preview shows it: plain, its citations as
 *  bare numbers - the paper's, from `order`, where it has them - and its
 *  Markdown marks dropped. */
export function previewText(
  markdown: string,
  order: ReadonlyMap<number, number> = new Map(),
): string {
  return markdown
    .replace(
      /\[(\d+)\]\([^)\s]*\)/g,
      (_, n: string) => `[${order.get(Number(n)) ?? n}]`,
    )
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`]{1,3}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A list item's state, drawn as a mark before it. */
function Mark({ state }: { state: string }) {
  return <span className="paper-card-mark" data-state={state} aria-hidden />;
}

/** What the run is doing in detail: the planner's thoughts, the questions
 *  and the helpers' latest steps, the outline as it is written, or each
 *  section with what its writer is writing. */
function PaperActivityView({ run, t }: { run: PaperRunState; t: Strings }) {
  const activity = { toolActivity: toolActivityLabels(t) };
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
                <Mark state={q.state} />
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
              <li key={a.id} className="paper-card-enter">
                <span className="paper-card-recent-detail">
                  {toolActivityText(a.tool, a.arguments, activity)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  if (run.phase === "outlining") {
    const draft = run.outlineDraft;
    return (
      <>
        {draft && draft.attempt > 1 && (
          <p className="paper-card-note">
            {fill(t.paperOutlineRetry, { n: String(draft.attempt) })}
          </p>
        )}
        {draft?.thesis ? (
          <p className="paper-card-thesis paper-card-enter">{draft.thesis}</p>
        ) : (
          run.thinking && <p className="paper-card-thinking">{run.thinking}</p>
        )}
        {draft && draft.titles.length > 0 && (
          <ol className="paper-card-list">
            {draft.titles.map((title, i) => (
              <li
                key={`${draft.attempt}-${i}`}
                className="paper-card-item paper-card-enter"
                data-state="done"
              >
                <Mark state="done" />
                <span className="paper-card-item-text">{title}</span>
              </li>
            ))}
          </ol>
        )}
      </>
    );
  }
  if ((run.phase === "drafting" || run.phase === "reviewing") && run.outline) {
    const order = citationOrder(
      run.outline.sections.map((_, i) => run.sectionText[i] ?? ""),
      new Set(run.sources?.sources.map((s) => s.n)),
    );
    return (
      <ol className="paper-card-list">
        {run.outline.sections.map((section, i) => {
          const status: SectionStatus | "waiting" =
            run.sections[i] ?? "waiting";
          const writing = status === "drafting" || status === "revising";
          const text = writing
            ? previewText(
                (run.sectionText[i] ?? "").slice(-PREVIEW_TAIL),
                order,
              )
            : "";
          return (
            <li key={i} className="paper-card-section" data-state={status}>
              <div className="paper-card-item" data-state={status}>
                <Mark state={status} />
                <span className="paper-card-item-text">{section.title}</span>
                <span className="paper-card-item-status">
                  {sectionStatus(status, t)}
                </span>
              </div>
              {text && (
                <div className="paper-card-preview">
                  <p>{text}</p>
                </div>
              )}
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
  const { t, settings } = useSettings();
  const run = usePaperRun(info.key);
  // A card back from History, or after a restart, asks how far its paper
  // came.
  useEffect(() => {
    if (!run) restorePaperCard(info.key, info.topic);
  }, [run, info.key, info.topic]);
  const running =
    run &&
    !run.error &&
    !run.paused &&
    (!run.written || run.picturesLeft > 0) &&
    (run.phase !== "awaitingOutline" || run.approving);
  const line = run ? progressLine(run, t, settings.language) : t.paperEnded;
  const busy = Boolean(running) && run?.phase !== "awaitingOutline";
  // Drafting says it in its progress line; reviewing only once sections
  // are being revised.
  const concurrency =
    run && busy && run.phase !== "drafting" ? paperConcurrency(run) : null;
  const showConcurrency =
    concurrency && (run?.phase !== "reviewing" || concurrency.active > 0);
  const elapsed = useElapsed(run?.phaseSince ?? 0, busy);
  return (
    <div className="paper-card">
      <div className="paper-card-head">
        <span className="paper-card-title">
          {run?.genre ? genreLabel(t, run.genre) : t.paperCardTitle}
        </span>
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
          {explainAiError(run.error, t)}
        </p>
      ) : (
        line && (
          <p className="paper-card-progress">
            {busy && <span className="paper-card-spinner" aria-hidden />}
            <span aria-live="polite">{line}</span>
            {busy && <span className="paper-card-elapsed">{elapsed}</span>}
          </p>
        )
      )}
      {run && concurrency && showConcurrency && (
        <p className="paper-card-note">
          {concurrencyLine(concurrency, run.phase, t, settings.language)}
        </p>
      )}
      {run?.webSearch === false &&
        busy &&
        (run.phase === "starting" ||
          run.phase === "planning" ||
          run.phase === "researching") && (
          <p className="paper-card-note paper-card-warning">
            {t.paperPapersOnly} {t.webSearchNeedsService}
          </p>
        )}
      {run && busy && <PaperActivityView run={run} t={t} />}
      {running ? (
        <div className="paper-card-actions">
          <button
            type="button"
            className="inline-chat-action"
            onClick={() => paperActions()?.stop(info.key)}
          >
            {t.paperPause}
          </button>
        </div>
      ) : (
        run?.paperId &&
        (run.paused || run.error) &&
        !run.written && (
          <div className="paper-card-actions">
            <button
              type="button"
              className="inline-chat-action"
              onClick={() => paperActions()?.resume(info.key)}
            >
              {t.paperContinue}
            </button>
          </div>
        )
      )}
    </div>
  );
}
