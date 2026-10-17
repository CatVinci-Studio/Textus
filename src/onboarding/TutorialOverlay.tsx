import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useModalDialog } from "../ui/useModalDialog";
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
  /** What to do. `code` spans (backticks) are what to type. */
  task?: string;
  /** One line of feedback on the exercise. */
  status?: string | null;
  complete?: boolean;
  /** A quieter line under the exercise (watching instead of doing). */
  note?: string | null;
  /** The lesson's animation on the website, as a link; absent when it is
   *  the primary action instead. */
  watch?: TutorialButton | null;
  /** Lesson-specific controls (the provider picker, the theme picker, the
   *  ending's links). */
  children?: ReactNode;
  primary: TutorialButton & { disabled?: boolean };
  /** A plain button before the primary one (Continue, while watching). */
  secondary?: TutorialButton | null;
  onBack: () => void;
  onSkip: () => void;
  /** Advance past THIS lesson without completing it. Shown only while the
   *  primary action is disabled - an exercise whose detection misfires
   *  must never leave "exit the whole guide" as the only way out. */
  onSkipStep?: () => void;
  labels: TutorialOverlayLabels;
}

// The welcome step shows the app icon instead (see the header below).
const STEP_GLYPHS: Record<Exclude<TutorialStepId, "welcome">, string> = {
  wysiwyg: "M↓",
  blocks: "∑",
  "modes-themes": "◐",
  "sidebar-export": "◧",
  connect: "⇄",
  "ai-panel": "✦",
  continuation: "↹",
  grammar: "✓",
  revision: "✎",
  review: "❝",
  skills: "/",
  memory: "◎",
  done: "✓",
};

/** `text` with its backtick spans as code - what the learner types. */
function withCode(text: string): ReactNode[] {
  return text
    .split("`")
    .map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
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
  task,
  status,
  complete,
  note,
  watch,
  children,
  primary,
  secondary,
  onBack,
  onSkip,
  onSkipStep,
  labels,
}: TutorialOverlayProps) {
  const titleId = useId();
  const bodyId = useId();
  const contentId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const modal = useModalDialog(onSkip, layout === "overlay");
  const [collapsedStep, setCollapsedStep] = useState<TutorialStepId | null>(
    null,
  );
  const collapsed = collapsedStep === stepId;
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
            onClick={() => setCollapsedStep(collapsed ? null : stepId)}
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
        {task && (
          <section
            className={`tutorial-task${complete ? " is-complete" : ""}`}
            aria-label={labels.tryIt}
          >
            <span className="tutorial-task-icon" aria-hidden>
              {complete ? "✓" : "→"}
            </span>
            <span>{withCode(task)}</span>
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
          {secondary && (
            <button
              type="button"
              className="tutorial-btn"
              onClick={secondary.onClick}
            >
              {secondary.label}
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
