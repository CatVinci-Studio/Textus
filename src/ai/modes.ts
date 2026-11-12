import type { ComponentType } from "react";
import type { TextKey } from "../i18n/strings";
import type { PanelMode } from "../prefs/settings-values";
import {
  CreateModeIcon,
  ResearchModeIcon,
  ReviewModeIcon,
  WriteModeIcon,
} from "../engine/controls/icons";

/** What each of Textus AI's modes is called and says, in one place: the
 *  composer's picker, the AI panel's empty state, Settings' skills and a
 *  skill's modes all read it. What a mode may do is Rust's
 *  (`agent::AgentMode`, `tools::EVERY_MODE`…). */
export const MODES: Record<
  PanelMode,
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
