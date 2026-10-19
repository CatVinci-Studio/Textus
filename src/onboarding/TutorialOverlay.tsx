import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useModalDialog } from "../ui/useModalDialog";
import { useCardPlacement } from "./card-placement";
import type { TutorialStepId } from "./tutorial-steps";
import "./TutorialOverlay.css";
import appIcon from "../../src-tauri/icons/128x128@2x.png";

interface TutorialOverlayLabels {
  back: string;
  collapse: string;
  expand: string;
  /** Leaves the whole tour. */
  skip: string;
  /** The per-lesson escape hatch shown while an exercise is incomplete. */
  skipStep: string;
  /** Heads the thing to do. */
  tryIt: string;
  chapters: string;
  /** "{i}"/"{n}" placeholders - the step counter. */
  stepOfCount: string;
}

interface TutorialChapterNavItem {
  label: string;
  active: boolean;
  done: boolean;
}

interface TutorialButton {
  label: string;
  onClick: () => void;
}

/** One line of what to do, and whether it is done. */
export interface TutorialTaskLine {
  text: string;
  done: boolean;
}

interface TutorialOverlayProps {
  /** Opening, connecting and ending dim the app; lessons leave the editor
   *  to work in, with the card at its side. */
  layout: "overlay" | "card";
  stepId: TutorialStepId;
  stepIndex: number;
  totalSteps: number;
  chapters: TutorialChapterNavItem[];
  title: string;
  /** The one sentence under the title. */
  body: string;
  /** What to do, a line each. `code` spans (backticks) are what to type. */
  tasks?: TutorialTaskLine[];
  /** One line of feedback on the exercise. */
  status?: string | null;
  /** The whole lesson is done (its feedback line turns to success). */
  complete?: boolean;
  /** A quieter line under the exercise (watching instead of doing). */
  note?: string | null;
  /** The lesson's animation on the website, as a link. */
  watch?: TutorialButton | null;
  /** Lesson-specific controls (the provider picker, the theme picker, the
   *  ending's links). */
  children?: ReactNode;
  primary: TutorialButton & { disabled?: boolean };
  onBack: () => void;
  onSkip: () => void;
  /** Advance past THIS lesson without completing it. Shown only while the
   *  primary action is disabled - an exercise whose detection misfires
   *  must never leave "exit the whole guide" as the only way out. */
  onSkipStep?: () => void;
  labels: TutorialOverlayLabels;
  /** The phone layout: a card goes to the top or the bottom. */
  phone?: boolean;
}

// The welcome step shows the app icon instead (see the header below).
const STEP_GLYPHS: Record<Exclude<TutorialStepId, "welcome">, string> = {
  wysiwyg: "M↓",
  marks: "B",
  table: "▦",
  blocks: "∑",
  "modes-themes": "◐",
  "sidebar-export": "◧",
  connect: "⇄",
  write: "✦",
  review: "❝",
  revision: "✎",
  grammar: "✓",
  continuation: "↹",
  skills: "/",
  done: "✓",
};

/** `text` with its code spans as code - what the learner types. As in
 *  Markdown, a span opened by a run of backticks closes at the next run as
 *  long, so ``a `b` c`` shows backticks (one space inside each end is
 *  dropped); an unclosed run stays text. */
export function withCode(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      plain += text[i++];
      continue;
    }
    let n = 0;
    while (text[i + n] === "`") n++;
    const fence = "`".repeat(n);
    let close = text.indexOf(fence, i + n);
    while (close !== -1 && text[close + n] === "`") {
      let skip = close;
      while (text[skip] === "`") skip++;
      close = text.indexOf(fence, skip);
    }
    if (close === -1) {
      plain += fence;
      i += n;
      continue;
    }
    let code = text.slice(i + n, close);
    if (code.length > 2 && code.startsWith(" ") && code.endsWith(" "))
      code = code.slice(1, -1);
    if (plain) out.push(plain);
    plain = "";
    out.push(<code key={out.length}>{code}</code>);
    i = close + n;
  }
  if (plain) out.push(plain);
  return out;
}

/**
 * One lesson card: where you are, a title, one sentence, the one thing to
 * do, and a link to watch it done. Lessons leave the editor usable beside
 * the card; the opening, connecting and ending sit over a dimmed window.
 */
export function TutorialOverlay({
  layout,
  stepId,
  stepIndex,
  totalSteps,
  chapters,
  title,
  body,
  tasks,
  status,
  complete,
  note,
  watch,
  children,
  primary,
  onBack,
  onSkip,
  onSkipStep,
  labels,
  phone = false,
}: TutorialOverlayProps) {
  const titleId = useId();
  const bodyId = useId();
  const contentId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const modal = useModalDialog(onSkip, layout === "overlay");
  // A lesson card keeps clear of the proposal, the notes and the review
  // bar it is about; with no room anywhere it folds to its header until
  // there is - unless the learner opened or folded it on this lesson.
  const placement = useCardPlacement(
    modal.ref,
    layout === "card",
    phone,
    stepId,
  );
  const [folded, setFolded] = useState<{
    stepId: TutorialStepId;
    collapsed: boolean;
  } | null>(null);
  const collapsed =
    folded?.stepId === stepId ? folded.collapsed : !placement.roomy;
  const progressLabel = labels.stepOfCount
    .replace("{i}", String(stepIndex + 1))
    .replace("{n}", String(totalSteps));

  useEffect(() => {
    if (layout === "overlay") primaryRef.current?.focus();
  }, [layout, stepIndex]);

  const card = (
    <div
      {...modal}
      className={`tutorial-surface tutorial-${layout} tutorial-step-${stepId} floating-surface`}
      style={placement.style}
      data-place={placement.place ?? undefined}
      role="dialog"
      aria-modal={layout === "overlay"}
      aria-labelledby={titleId}
      aria-describedby={collapsed ? undefined : bodyId}
    >
      <div className="tutorial-chapters" aria-label={labels.chapters}>
        {chapters.map((chapter) => (
          <span
            className={`tutorial-chapter${chapter.active ? " is-current" : ""}${chapter.done ? " is-done" : ""}`}
            aria-current={chapter.active ? "step" : undefined}
            key={chapter.label}
          >
            {chapter.label}
          </span>
        ))}
      </div>
      <div
        className="tutorial-progress"
        role="progressbar"
        aria-label={progressLabel}
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-valuenow={stepIndex + 1}
      >
        {Array.from({ length: totalSteps }, (_, i) => (
          <span
            key={i}
            className={`tutorial-progress-segment${i === stepIndex ? " is-current" : ""}${i < stepIndex ? " is-done" : ""}`}
          />
        ))}
      </div>
      <header className="tutorial-header">
        {stepId === "welcome" ? (
          <img className="tutorial-glyph-icon" src={appIcon} alt="" />
        ) : (
          <div className="tutorial-glyph" aria-hidden>
            {STEP_GLYPHS[stepId]}
          </div>
        )}
        <div>
          <div className="tutorial-step-label">{progressLabel}</div>
          <h2 className="tutorial-title" id={titleId}>
            {title}
          </h2>
        </div>
        {layout === "card" && (
          <button
            type="button"
            className="tutorial-collapse"
            aria-expanded={!collapsed}
            aria-controls={contentId}
            onClick={() => setFolded({ stepId, collapsed: !collapsed })}
          >
            {collapsed ? labels.expand : labels.collapse}
          </button>
        )}
      </header>
      <div
        id={contentId}
        className="tutorial-lesson-content"
        hidden={collapsed}
      >
        <p className="tutorial-body" id={bodyId}>
          {body}
        </p>
        {tasks && tasks.length > 0 && (
          <section className="tutorial-task" aria-label={labels.tryIt}>
            <ol className="tutorial-task-lines">
              {tasks.map((line, i) => (
                <li
                  key={i}
                  className={`tutorial-task-line${line.done ? " is-complete" : ""}`}
                >
                  <span className="tutorial-task-icon" aria-hidden>
                    {line.done ? "✓" : tasks.length > 1 ? i + 1 : "→"}
                  </span>
                  <span>{withCode(line.text)}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {status && (
          <div
            className={`tutorial-status${complete ? " is-complete" : ""}`}
            role="status"
            aria-live="polite"
          >
            {status}
          </div>
        )}
        {children}
        {note && <p className="tutorial-note">{note}</p>}
        {watch && (
          <button
            type="button"
            className="tutorial-watch"
            onClick={watch.onClick}
          >
            <span className="tutorial-watch-icon" aria-hidden>
              ▶
            </span>
            {watch.label}
            <span aria-hidden>↗</span>
          </button>
        )}
      </div>
      <div className="tutorial-actions">
        <button type="button" className="tutorial-link-btn" onClick={onSkip}>
          {labels.skip}
        </button>
        <div className="tutorial-actions-main">
          {onSkipStep && primary.disabled && (
            <button
              type="button"
              className="tutorial-link-btn"
              onClick={onSkipStep}
            >
              {labels.skipStep}
            </button>
          )}
          {stepIndex > 0 && (
            <button type="button" className="tutorial-btn" onClick={onBack}>
              {labels.back}
            </button>
          )}
          <button
            ref={primaryRef}
            type="button"
            className="tutorial-btn tutorial-btn-primary"
            onClick={primary.onClick}
            disabled={primary.disabled}
          >
            {primary.label}
          </button>
        </div>
      </div>
    </div>
  );

  if (layout === "overlay") {
    return <div className="tutorial-backdrop">{card}</div>;
  }

  return card;
}
