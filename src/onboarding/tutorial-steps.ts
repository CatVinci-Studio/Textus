import type { TextKey } from "../i18n/strings";
import type { AgentMode } from "../prefs/SettingsContext";
import { hasTextusAi } from "../platform/capabilities";

/**
 * The first-run tour: the window part by part, each one lit while the rest
 * dims, a small card beside it. A step that asks for something moves on by
 * itself once it is done; the AI's steps run only with Textus AI on, and its
 * last only with an AI signed in.
 */

export type TutorialStepId =
  | "welcome"
  | "sidebar"
  | "rail"
  | "settings"
  | "editor"
  | "ai"
  | "signin"
  | "ai-use"
  | "done";

/** What the learner does that moves a step on by itself. */
export type TutorialUntil =
  "sidebar-open" | "formatted" | "ai-open" | "signed-in" | "revision-decided";

/** One part of a step lit in turn, a line of its own. */
export interface TutorialStop {
  target: string;
  key: TextKey;
}

export interface TutorialStep {
  id: TutorialStepId;
  titleKey: TextKey;
  bodyKey: TextKey;
  /** Its wording on a phone, where it differs. */
  phoneBodyKey?: TextKey;
  /** What it lights; none: a card in the middle of the dimmed window. */
  target?: string;
  phoneTarget?: string;
  /** Lit one after another, Next going through them. */
  stops?: TutorialStop[];
  until?: TutorialUntil;
  /** The window left undimmed: what the step leads to opens elsewhere
   *  (signing in, in Settings). */
  open?: boolean;
  /** A Textus AI step. */
  ai?: boolean;
  /** Only with an AI signed in. */
  live?: boolean;
  /** The AI panel's mode this step sets. */
  agentMode?: AgentMode;
}

const RAIL = (id: string) => `.activity-rail [data-rail-id="${id}"]`;

const ALL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    titleKey: "tutorialWelcomeTitle",
    bodyKey: "tutorialWelcomeBody",
  },
  {
    id: "sidebar",
    titleKey: "tutorialSidebarTitle",
    bodyKey: "tutorialSidebarBody",
    phoneBodyKey: "tutorialSidebarBodyPhone",
    target: RAIL("tree"),
    phoneTarget: ".window-bar-sidebar-toggle",
    until: "sidebar-open",
  },
  {
    id: "rail",
    titleKey: "tutorialRailTitle",
    bodyKey: "tutorialRailBody",
    stops: [
      { target: RAIL("tree"), key: "tutorialRailFiles" },
      { target: RAIL("outline"), key: "tutorialRailOutline" },
      { target: RAIL("search"), key: "tutorialRailSearch" },
      { target: RAIL("plugins"), key: "tutorialRailPlugins" },
    ],
  },
  {
    id: "settings",
    titleKey: "tutorialSettingsTitle",
    bodyKey: "tutorialSettingsBody",
    target: ".activity-rail-settings",
  },
  {
    id: "editor",
    titleKey: "tutorialEditorTitle",
    bodyKey: "tutorialEditorBody",
    target: '[data-active-tab="true"] .editor-scroll',
    until: "formatted",
  },
  {
    id: "ai",
    titleKey: "tutorialAiTitle",
    bodyKey: "tutorialAiBody",
    phoneBodyKey: "tutorialAiBodyPhone",
    target: ".window-bar-toggle",
    until: "ai-open",
    ai: true,
  },
  {
    id: "signin",
    titleKey: "tutorialSignInTitle",
    bodyKey: "tutorialSignInBody",
    target: ".agent-panel-view",
    until: "signed-in",
    open: true,
    ai: true,
  },
  {
    id: "ai-use",
    titleKey: "tutorialAiUseTitle",
    bodyKey: "tutorialAiUseBody",
    target: ".agent-panel-view",
    until: "revision-decided",
    ai: true,
    live: true,
    agentMode: "write",
  },
  {
    id: "done",
    titleKey: "tutorialDoneTitle",
    bodyKey: "tutorialDoneBody",
  },
];

/** Without Textus AI (capabilities.ts) the tour has no AI steps. */
export const TUTORIAL_STEPS = ALL_STEPS.filter((s) => hasTextusAi || !s.ai);

export function stepIndexOf(id: TutorialStepId): number {
  return TUTORIAL_STEPS.findIndex((step) => step.id === id);
}

/** Where saved progress resumes: its step, or the start for one unknown
 *  (a step since renamed or dropped). */
export function resolveSavedStep(saved: { stepId?: unknown }): number {
  const at = TUTORIAL_STEPS.findIndex((step) => step.id === saved.stepId);
  return Math.max(0, at);
}
