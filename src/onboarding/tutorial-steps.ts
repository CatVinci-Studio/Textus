import type { TextKey } from "../i18n/strings";

type TutorialSectionId = "markdown" | "workspace" | "ai";

export type TutorialStepId =
  | "welcome"
  | "markdownIntro"
  | "markdownPractice"
  | "sidebar"
  | "aiIntro"
  | "completion"
  | "grammar"
  | "agentChat"
  | "agentEdit"
  | "done";

export interface TutorialSection {
  id: TutorialSectionId;
  titleKey: TextKey;
}

export interface TutorialStep {
  id: TutorialStepId;
  /** Opening and ending frame the two chapters rather than belonging to one. */
  section: TutorialSectionId | null;
  layout: "overlay" | "card";
  titleKey: TextKey;
  bodyKey: TextKey;
}

/**
 * The first-run experience has three visible chapters. Each entry in
 * TUTORIAL_STEPS is one independently navigable lesson card inside a
 * chapter; reading lessons use a focused overlay while exercises keep the
 * editor interactive underneath.
 */
export const TUTORIAL_SECTIONS: TutorialSection[] = [
  { id: "markdown", titleKey: "tutorialSectionMarkdown" },
  { id: "workspace", titleKey: "tutorialSectionWorkspace" },
  { id: "ai", titleKey: "tutorialSectionAi" },
];

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    section: null,
    layout: "overlay",
    titleKey: "tutorialWelcomeTitle",
    bodyKey: "tutorialWelcomeBody",
  },
  {
    id: "markdownIntro",
    section: "markdown",
    layout: "overlay",
    titleKey: "tutorialMarkdownIntroTitle",
    bodyKey: "tutorialMarkdownIntroBody",
  },
  {
    id: "markdownPractice",
    section: "markdown",
    layout: "card",
    titleKey: "tutorialMarkdownPracticeTitle",
    bodyKey: "tutorialMarkdownPracticeBody",
  },
  {
    // The sidebar starts collapsed and its four tabs are icons only, so a
    // newcomer had no way to learn it existed, let alone what each tab is
    // for. Opens it and has the learner visit each tab.
    id: "sidebar",
    section: "workspace",
    layout: "card",
    titleKey: "tutorialSidebarTitle",
    bodyKey: "tutorialSidebarBody",
  },
  {
    id: "aiIntro",
    section: "ai",
    layout: "overlay",
    titleKey: "tutorialAiIntroTitle",
    bodyKey: "tutorialAiIntroBody",
  },
  {
    id: "completion",
    section: "ai",
    layout: "card",
    titleKey: "tutorialCompletionTitle",
    bodyKey: "tutorialCompletionBody",
  },
  {
    id: "grammar",
    section: "ai",
    layout: "card",
    titleKey: "tutorialGrammarTitle",
    bodyKey: "tutorialGrammarBody",
  },
  {
    id: "agentChat",
    section: "ai",
    layout: "card",
    titleKey: "tutorialAgentChatTitle",
    bodyKey: "tutorialAgentChatBody",
  },
  {
    id: "agentEdit",
    section: "ai",
    layout: "card",
    titleKey: "tutorialAgentEditTitle",
    bodyKey: "tutorialAgentEditBody",
  },
  {
    id: "done",
    section: null,
    layout: "overlay",
    titleKey: "tutorialDoneTitle",
    bodyKey: "tutorialDoneBody",
  },
];
