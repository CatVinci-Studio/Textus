import type { ComponentType } from "react";
import type { TextKey } from "../i18n/strings";
import type { AgentMode } from "../prefs/settings-types";
import {
  CreateModeIcon,
  ResearchModeIcon,
  ReviewModeIcon,
  WriteModeIcon,
} from "../ui/icons";

/** What each of Textus AI's modes is called and says, in one place: the
 *  composer's picker, the AI panel's empty state, Settings' skills and a
 *  skill's modes all read it. What a mode may do is Rust's
 *  (`agent::ChatMode`, `tools::EVERY_MODE`…). */
export const MODES: Record<
  AgentMode,
  { label: TextKey; hint: TextKey; empty: TextKey; icon: ComponentType }
> = {
  write: {
    label: "agentModeWrite",
    hint: "agentModeWriteHint",
    empty: "agentPanelEmptyWrite",
    icon: WriteModeIcon,
  },
  review: {
    label: "agentModeReview",
    hint: "agentModeReviewHint",
    empty: "agentPanelEmptyReview",
    icon: ReviewModeIcon,
  },
  create: {
    label: "agentModeCreate",
    hint: "agentModeCreateHint",
    empty: "agentPanelEmptyCreate",
    icon: CreateModeIcon,
  },
  research: {
    label: "agentModeResearch",
    hint: "agentModeResearchHint",
    empty: "agentPanelEmptyResearch",
    icon: ResearchModeIcon,
  },
};
