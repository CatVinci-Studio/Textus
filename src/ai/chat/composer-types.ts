import type { ReactNode, RefObject } from "react";
import type { ChatAttachment, ThinkingLevel } from "../types";
import { resolveStrings } from "../../i18n/strings";
import { pickerLabels, type PickerLabels } from "./ComposerPicker";
import type { AgentMode, PanelMode } from "../../prefs/SettingsContext";

// What ChatComposer is given, apart from the component so the hooks and
// windows that only pass these along needn't import it.

/** What ChatBody may do to the composer. */
export interface ChatComposerHandle {
  /** Puts `text` in the box, before what is there, and focuses it. */
  restore: (text: string) => void;
}

/** What ChatBody may do to the composer. */
export interface ChatComposerHandle {
  /** Puts `text` in the box, before what is there, and focuses it. */
  restore: (text: string) => void;
}

export interface ChatComposerLabels {
  /** After a suggestion in the empty box: the key that takes it. */
  suggestionTab: string;
  /** Accessible name of the selection chip's remove button. */
  dropSelection: string;
  /** The docked Quick Ask's context line when nothing is selected. */
  atCursor: string;
  placeholder: string;
  /** The box in Research mode, where the message is a paper's topic. */
  researchPlaceholder: string;
  send: string;
  /** Send button's label while a request is in flight - clicking it then
   *  stops the request instead of sending. */
  stop: string;
  /** Tooltip of the "+" attach-file button. */
  attachFile: string;
  /** The selection chip's text for a selection of `n` characters. */
  selectedChars: (n: number) => string;
  /** The chip of a selection that is one picture. */
  selectedPicture: string;
  /** Tooltip of the chip: a click scrolls the passage into view. */
  showSelection: string;
  /** Suffix on an attachment chip whose text was cut at the extraction cap. */
  attachmentTruncated: string;
  /** Shown when an image is attached but the active provider has no vision. */
  attachmentNoVision: string;
  modeWrite: string;
  modeReview: string;
  modeCreate: string;
  modeResearch: string;
  /** One line on what each mode does, under its name in the picker. */
  modeWriteHint: string;
  modeReviewHint: string;
  modeCreateHint: string;
  modeResearchHint: string;
  /** Accessible name of the phone's segmented mode control, and the
   *  picker's heading over the modes. */
  modeLabel: string;
  /** The picker's heading over the models. */
  modelLabel: string;
  /** Accessible name of the picker: the mode and the model. */
  modeAndModelLabel: string;
  webSearch: string;
  deepThinking: string;
  /** Deep thinking's tooltip: what turning it on does. */
  deepThinkingHint: string;
  /** A toggle's tooltip while it is on: "{label}" and how to turn it off. */
  toggleOnHint: string;
  /** The Web search button's tooltip when nothing can search: the model
   *  can't, and no search service is set up. */
  webSearchNeedsService: string;
  /** The `/` and `@` pickers' words; English when left out. */
  picker?: PickerLabels;
}

/** What the selection chip tells the document: whether it shows (the
 *  selection rides with the next message) and whether the pointer is on
 *  it. */
export interface SelectionChip {
  shown: boolean;
  hot: boolean;
}

/** The chip's link to the passage it stands for, kept highlighted in the
 *  document while the chip shows. */
export interface SelectionChipHandlers {
  onChange: (chip: SelectionChip) => void;
  /** The chip was clicked: bring the passage into view. */
  onReveal: () => void;
}

let englishPicker: PickerLabels | null = null;
export function defaultPickerLabels(): PickerLabels {
  englishPicker ??= pickerLabels(resolveStrings("en"), "en");
  return englishPicker;
}

/** How many matching project files the `@` picker lists. */
export const FILE_LIMIT = 30;

export interface ChatComposerProps {
  /** What the writer will probably say next: grey in the empty box, Tab
   *  takes it. */
  suggestion?: string | null;
  /** Resolves the agent workspace (skills) - re-loaded whenever it changes. */
  docPath: string | null;
  /** Explicit workspace root, or null for the document's own folder. Skills
   *  come from whichever it resolves to. */
  workspaceRoot: string | null;
  selectedText: string | null;
  /** The selection is one picture: the chip says so, rather than count
   *  its alt text's characters. */
  selectionIsPicture?: boolean;
  busy: boolean;
  labels: ChatComposerLabels;
  defaultMode: AgentMode;
  /** The panel and the detached window: the mode picked carries over to
   *  the next conversation. Quick Ask keeps its own. */
  carryMode?: boolean;
  /** The tour's lesson's mode, put in place whenever it changes; the learner
   *  can still pick another. Not carried over. */
  tourMode?: AgentMode | null;
  selectionChip?: SelectionChipHandlers;
  /** The panel and the detached window: a selection rides with one message,
   *  so sending uses it up. Quick Ask's stays for its whole conversation. */
  selectionPerMessage?: boolean;
  /** Quick Ask: no attach, web-search or Deep thinking buttons, and it asks
   *  for a fast answer. */
  compact?: boolean;
  /** Focus the input as the composer appears (default). Off for the phone's
   *  AI sheet, where raising the keyboard right away flashes. */
  focusOnOpen?: boolean;
  defaultWebSearch: boolean;
  /** The docked Quick Ask on a phone: its top row quotes what the request
   *  is about and carries these controls beside it. */
  dockActions?: ReactNode;
  /** The mode picker lists the models under the modes: the panel and the
   *  chat window, not Quick Ask. */
  switchModels?: boolean;
  /** The resolved message (skill expanded) plus any attachments; the caller
   *  tags and sends it. */
  onSend: (
    message: string,
    attachments: ChatAttachment[],
    /** False once the user has removed the selection chip. */
    includeSelection: boolean,
    options: { mode: AgentMode; webSearch: boolean; thinking: ThinkingLevel },
    /** What was typed (before a skill expanded it), for the queue's Edit
     *  to put back. */
    typed: string,
  ) => void;
  /** Lets ChatBody put text back in the box: a queued message being
   *  edited, or the queue a Stop dropped. */
  handle?: RefObject<ChatComposerHandle | null>;
  onStop: () => void;
  onEscape: () => void;
  /** The mode as it is now, on the first render and on every switch. */
  onModeChange?: (mode: PanelMode) => void;
  /** The panel: Research is offered, and a message sent in it is the
   *  topic of a paper, handed here instead of to onSend. */
  onResearch?: (topic: string) => void;
  /** Research mode's choices (the paper's length), in the toolbar where
   *  the other modes have their attach, search and Deep buttons. */
  researchControls?: ReactNode;
}
