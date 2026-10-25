import type { ReactNode, RefObject } from "react";
import type { ChatAttachment, ThinkingLevel } from "../types";
import { resolveStrings } from "../../i18n/strings";
import { pickerLabels, type PickerLabels } from "./ComposerPicker";
import type { AgentMode } from "../../settings/SettingsContext";

// What ChatComposer.tsx is given: its labels, the selection chip it shows,
// and its props - apart from the component, so the hooks and windows that
// only pass these along needn't import it.

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
  /** Accessible name of the phone's segmented mode control. */
  modeLabel: string;
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
 *  document while the chip shows (useChatSelectionHighlight). */
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
  /** What the writer will probably say next (next-message.ts): grey in the
   *  empty box, Tab takes it. */
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
   *  the next conversation (last-mode.ts). Quick Ask keeps its own. */
  carryMode?: boolean;
  /** The tour's lesson's mode (onboarding/), put in place whenever it
   *  changes; the learner can still pick another. Not carried over. */
  tourMode?: AgentMode | null;
  /** See SelectionChipHandlers. */
  selectionChip?: SelectionChipHandlers;
  /** The panel and the detached window: a selection rides with one
   *  message, so sending uses it up and the chip (with the highlight) goes
   *  until the next selection. Quick Ask's captured selection stays for its
   *  whole conversation. */
  selectionPerMessage?: boolean;
  /** Quick Ask: no attach, web-search or Deep thinking buttons - those
   *  stay in the panel (an @-mention still attaches a project file) - and
   *  it asks for a fast answer: it is for a quick change. */
  compact?: boolean;
  /** Focus the input as the composer appears (default). Off for the
   *  phone's AI sheet: focusing it raised the keyboard straight after the
   *  document's went down - a flash - so the sheet opens with the keyboard
   *  away and a tap on the input brings it up. */
  focusOnOpen?: boolean;
  defaultWebSearch: boolean;
  /** The docked Quick Ask on a phone (InlineChat's `docked`): its top row
   *  quotes what the request is about - the selection, or "at the cursor" -
   *  in place of the toolbar's "{n} chars selected" chip, and carries these
   *  controls (new, continue in panel, close) beside it. */
  dockActions?: ReactNode;
  /** The model button (ModelSwitcher), in the toolbar after the toggles;
   *  the caller renders it, as it reads Settings and this doesn't. */
  modelSwitcher?: ReactNode;
  /** The resolved message (skill expanded) plus any attachments - InlineChat
   *  owns tagging it with selected-text/chatInfo and actually sending it. */
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
  /** The message just sent went through a skill (`/name`) - the tour's
   *  skills lesson waits for it. */
  onSkillUsed?: () => void;
  onStop: () => void;
  onEscape: () => void;
  /** The mode as it is now - on the first render and on every switch (the
   *  AI panel's empty state says what it will do). */
  onModeChange?: (mode: AgentMode) => void;
}
