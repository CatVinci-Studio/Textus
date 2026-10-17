import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useModalDialog } from "../ui/useModalDialog";
import type { TutorialStepId } from "./tutorial-steps";
import "./TutorialOverlay.css";
import appIcon from "../../src-tauri/icons/128x128@2x.png";

interface TutorialOverlayLabels {
  back: string;
  collapse?: string;
  expand?: string;
  skip: string;
  /** The per-lesson escape hatch shown while an exercise is incomplete. */
  skipStep: string;
  practice: string;
  learned: string;
  courseSections: string;
  /** "{item}" is replaced with the exercise text. */
  skipItem: string;
  /** "{i}"/"{n}" placeholders - screen-reader text for the progress rail. */
  stepOfCount: string;
}

export interface TutorialChecklistItem {
  label: string;
  done: boolean;
  onSkip?: () => void;
}

interface TutorialSectionNavItem {
  label: string;
  active: boolean;
  done: boolean;
}

interface TutorialOverlayProps {
  /** Reading steps dim the app; practice steps leave the editor interactive. */
  layout: "overlay" | "card";
  stepId: TutorialStepId;
  stepIndex: number;
  totalSteps: number;
  sections: TutorialSectionNavItem[];
  /** Chapter-local exercise number, e.g. AI exercises 01 through 04. */
  activityNumber?: string;
  title: string;
  body: string;
  /** A literal phrase the learner should type/send. */
  task?: string;
  /** Several independently detected exercises, used by the Markdown lesson. */
  checklist?: TutorialChecklistItem[];
  /** The four skills previewed at the start and recapped at the end. */
  roadmap?: string[];
  /** Live one-line feedback under the exercise. */
  status?: string | null;
  /** Lesson-specific controls under the body (the provider picker of the
   *  "Connect your AI" lesson). */
  children?: ReactNode;
  waiting?: boolean;
  complete?: boolean;
  primaryLabel: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
  onBack: () => void;
  onSkip: () => void;
  /** Advance past THIS lesson without completing it. Rendered only while
   *  the primary action is disabled - an exercise whose detection misfires
   *  must never leave "exit the whole guide" as the only way out. */
  onSkipStep?: () => void;
  labels: TutorialOverlayLabels;
}

// The welcome step shows the app icon instead (see the header below).
const STEP_GLYPHS: Record<Exclude<TutorialStepId, "welcome">, string> = {
  markdownIntro: "M↓",
  markdownPractice: "#",
  sidebar: "◧",
  aiIntro: "AI",
  completion: "↹",
  grammar: "✓",
  agentChat: "…",
  agentEdit: "✎",
  connectAi: "⇄",
  done: "✓",
};

/**
 * A small lesson, not a tooltip: orientation, one concrete exercise, then
 * live feedback. Practice steps keep the editor available; reading steps use
 * the same visual language in a focused modal so the whole tour feels like
 * one continuous course.
 */
export function TutorialOverlay({
  layout,
  stepId,
  stepIndex,
  totalSteps,
  sections,
  activityNumber,
  title,
  body,
  task,
  checklist,
  roadmap,
  status,
  children,
  waiting,
  complete,
  primaryLabel,
  primaryDisabled,
  onPrimary,
  onBack,
  onSkip,
  onSkipStep,
  labels,
}: TutorialOverlayProps) {
  const titleId = useId();
  const bodyId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const modal = useModalDialog(onSkip, layout === "overlay");
  const [collapsedStep, setCollapsedStep] = useState<TutorialStepId | null>(
    null,
  );
  const collapsed = collapsedStep === stepId;
  const contentId = useId();
  const progressLabel = labels.stepOfCount
    .replace("{i}", String(stepIndex + 1))
    .replace("{n}", String(totalSteps));

  useEffect(() => {
    if (layout === "overlay") primaryRef.current?.focus();
  }, [layout, stepIndex]);

  const progress = (
    <>
      <div className="tutorial-section-nav" aria-label={labels.courseSections}>
        {sections.map((section, index) => (
          <div
            className={`tutorial-section-nav-item${section.active ? " is-current" : ""}${section.done ? " is-done" : ""}`}
            key={section.label}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {section.label}
          </div>
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
    </>
  );

  const actions = (
    <div className="tutorial-actions">
      <button type="button" className="tutorial-link-btn" onClick={onSkip}>
        {labels.skip}
      </button>
      <div className="tutorial-actions-main">
        {onSkipStep && primaryDisabled && (
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
          onClick={onPrimary}
          disabled={primaryDisabled}
        >
          {primaryLabel}
          {!primaryDisabled && <span aria-hidden>→</span>}
        </button>
      </div>
    </div>
  );

  const activity = (task || checklist) && (
    <section className="tutorial-practice" aria-label={labels.practice}>
      <div className="tutorial-section-label">
        <span className="tutorial-section-number">{activityNumber}</span>
        {labels.practice}
      </div>
      {task && <div className="tutorial-task-text">{task}</div>}
      {checklist && (
        <div className="tutorial-checklist">
          {checklist.map((item, index) => (
            <div
              className={`tutorial-check${item.done ? " is-done" : ""}`}
              key={index}
            >
              {item.done || !item.onSkip ? (
                <span className="tutorial-check-icon" aria-hidden>
                  {item.done ? "✓" : index + 1}
                </span>
              ) : (
                <button
                  type="button"
                  className="tutorial-check-icon tutorial-check-skip"
                  aria-label={labels.skipItem.replace("{item}", item.label)}
                  title={labels.skipItem.replace("{item}", item.label)}
                  onClick={item.onSkip}
                >
                  {index + 1}
                </button>
              )}
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  const statusLine = status ? (
    <div
      className={`tutorial-status${complete ? " is-complete" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="tutorial-status-icon" aria-hidden>
        {complete ? "✓" : waiting ? "" : "→"}
      </span>
      <span>{status}</span>
    </div>
  ) : null;

  const roadmapView = roadmap && (
    <div className="tutorial-roadmap">
      {roadmap.map((item, index) => (
        <div className="tutorial-roadmap-item" key={item}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          {item}
        </div>
      ))}
    </div>
  );

  const card = (
    <div
      {...modal}
      className={`tutorial-surface tutorial-${layout} tutorial-step-${stepId} floating-surface`}
      role="dialog"
      aria-modal={layout === "overlay"}
      aria-labelledby={titleId}
      aria-describedby={collapsed ? undefined : bodyId}
    >
      {progress}
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
        {layout === "card" && labels.collapse && labels.expand && (
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
        {roadmapView}
        {children}
        {activity}
        {statusLine}
        {complete && layout === "card" && (
          <div className="tutorial-learned">{labels.learned}</div>
        )}
      </div>
      {actions}
    </div>
  );

  if (layout === "overlay") {
    return <div className="tutorial-backdrop">{card}</div>;
  }

  return card;
}
