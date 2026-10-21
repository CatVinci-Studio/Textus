import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatAttachment, ThinkingLevel } from "../types";
import { resolveSkillMessage } from "./proposal";
import { ai } from "../../platform/ipc";
import {
  ComposerPicker,
  type PickerRow,
  type PickerSection,
} from "./ComposerPicker";
import {
  MENTION_TOKEN,
  MENTION_TRIGGER,
  SKILL_COMMAND,
  groupSkills,
  matchSkills,
  rememberSkill,
  resolveSkillName,
  type PickerSkill,
} from "./skill-picker";
import { errorText } from "../../utils/error-text";
import { basename } from "../../utils/path";
import { useActiveProvider, useWebSearchStatus } from "../provider-catalog";
import type { AgentMode } from "../../settings/SettingsContext";
import {
  COMPOSER_MODES,
  fitMode,
  initialMode,
  rememberMode,
} from "./last-mode";
import {
  CloseIcon,
  GenericFileIcon,
  ImageFileIcon,
  LightbulbIcon,
  PlusIcon,
  SearchIcon,
} from "../../ui/icons";
import {
  deepThinkingOn,
  rememberDeepThinking,
  useCanThinkDeeper,
} from "./deep-thinking";
import { Select } from "../../ui/Select";
import { Tooltip } from "../../ui/Tooltip";
import { usePhoneLayout } from "../../ui/usePhoneLayout";
import { useLatest } from "../../utils/hooks/useLatest";
import { useComposerSkills } from "./useComposerSkills";
import {
  defaultPickerLabels,
  FILE_LIMIT,
  type ChatComposerProps,
} from "./composer-types";

export type {
  ChatComposerLabels,
  SelectionChip,
  SelectionChipHandlers,
} from "./composer-types";

/**
 * The input row: auto-growing textarea, attach button, selection chip, send
 * button, and the /name skill picker it drives. Self-contained input state
 * (what's typed, staged attachments) - InlineChat only hears about a
 * finished, resolved message via onSend.
 */
export function ChatComposer({
  docPath,
  workspaceRoot,
  selectedText,
  selectionIsPicture = false,
  busy,
  labels,
  defaultMode,
  modes: offeredModes = COMPOSER_MODES.full,
  carryMode = false,
  tourMode = null,
  selectionChip,
  selectionPerMessage = false,
  compact = false,
  focusOnOpen = true,
  defaultWebSearch,
  dockActions,
  onSend,
  onSkillUsed,
  onStop,
  onEscape,
  onModeChange,
}: ChatComposerProps) {
  const phone = usePhoneLayout();
  // Derived here rather than passed in: this is the only place an image can
  // be staged, so deriving it at the gate makes it impossible for a caller to
  // forget - which is exactly what happened when it was a prop, leaving Quick
  // Ask happy to attach an image to a provider that can't read one.
  const supportsVision = useActiveProvider()?.supportsVision ?? true;
  // With search on but nothing to search with - a model that can't search
  // by itself and no search service set up - the button says so, rather
  // than the request quietly going out without the web.
  const searchStatus = useWebSearchStatus();
  const searchUnavailable =
    !!searchStatus && !searchStatus.native && !searchStatus.service;
  const picker = labels.picker ?? defaultPickerLabels();
  const [input, setInput] = useState("");
  const [pickerIndex, setPickerIndex] = useState(0);
  // Escape closes a picker for the input as it stands; typing reopens it.
  const [dismissedInput, setDismissedInput] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [mode, setModeState] = useState<AgentMode>(
    () =>
      tourMode ??
      fitMode(carryMode ? initialMode(defaultMode) : defaultMode, offeredModes),
  );
  useEffect(() => {
    if (tourMode) setModeState(tourMode);
  }, [tourMode]);
  const onModeChangeRef = useLatest(onModeChange);
  useEffect(() => onModeChangeRef.current?.(mode), [mode, onModeChangeRef]);
  const setMode = (next: AgentMode) => {
    setModeState(next);
    if (carryMode) rememberMode(next, defaultMode);
  };
  const [webSearch, setWebSearch] = useState(defaultWebSearch);
  const [deepThinking, setDeepThinking] = useState(deepThinkingOn);
  // Shown only where it changes something: a model that doesn't think, or
  // thinks one fixed way, has no button - and no Deep, even if it was left
  // on for another model.
  const canThinkDeeper = useCanThinkDeeper(!compact);
  const thinking: ThinkingLevel = compact
    ? "fast"
    : deepThinking && canThinkDeeper
      ? "deep"
      : "auto";
  // Why an attachment couldn't be used ("this PDF has no text layer", "too
  // large", ...). Shown, never swallowed: the previous version caught and
  // discarded every failure, so picking a PDF - which could not work at all,
  // the reader being read_to_string - looked exactly like a dead "+" button.
  const [attachError, setAttachError] = useState<string | null>(null);
  // The selection rides along as context by default, but a question about
  // the document as a whole shouldn't be forced to carry whatever happened
  // to be highlighted - dropping it is a click, not a re-selection.
  //
  // Dropping applies to THAT selection, not to the chat forever: in the
  // detached window the user goes on highlighting new passages, and each one
  // is a fresh request to talk about it. Remembering which text was
  // dismissed (rather than a bare flag) gets both halves right - the chip
  // stays gone while that selection is current, and a genuinely new
  // selection brings it back without the user having to reopen anything.
  const [droppedSelection, setDroppedSelection] = useState<string | null>(null);
  const selectionDropped =
    droppedSelection !== null && droppedSelection === selectedText;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const {
    skills,
    available,
    recent,
    refreshRecent,
    skillTrigger,
    skillMenuOpen,
  } = useComposerSkills({
    docPath,
    workspaceRoot,
    input,
    dismissedInput,
    lang: picker.lang,
  });

  // The input grows with its content (Shift+Enter newlines) up to the CSS
  // max-height, then scrolls - a fixed single row just scrolled horizontally
  // out of view.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    let needed = el.scrollHeight;
    el.style.height = `${needed}px`;
    // scrollHeight is an integer, so the height just written can land a
    // fraction of a pixel short of the line box it was measured from -
    // WebKit then treats the textarea as scrolled by that hair, which clips
    // the caret (most visible with CJK text, whose glyph box fills the line
    // completely). One correction pass, and it fits whatever the font does.
    if (el.scrollHeight > el.clientHeight) {
      needed += el.scrollHeight - el.clientHeight;
      el.style.height = `${needed}px`;
    }
    // Scrolling is enabled only once the content genuinely outgrows the box;
    // leaving it permanently on is what drew scrollbars around an EMPTY input.
    const max = parseFloat(getComputedStyle(el).maxHeight);
    el.style.overflowY = needed > max ? "auto" : "hidden";
  }, [input]);

  async function attachFile() {
    setAttachError(null);
    try {
      const file = await ai.pickAttachmentFile();
      // null means the picker was cancelled - not something to report.
      if (!file) return;
      if (file.kind === "image" && !supportsVision) {
        setAttachError(labels.attachmentNoVision);
        return;
      }
      setAttachments((prev) => [...prev, file]);
    } catch (err) {
      setAttachError(errorText(err));
    }
  }

  // @-mention picker: "@" (or the full-width "＠" a CJK IME types) plus a
  // partial path at the end of the input lists matching project files
  // (ai::project); picking one attaches its text as a chip and removes the
  // "@query" from the message. The list is fetched on the first "@", not on
  // mount - most messages never mention a file.
  const mentionQuery = skillTrigger ? null : MENTION_TRIGGER.exec(input);
  const mentionMenuOpen = !!mentionQuery && dismissedInput !== input;
  const [projectFiles, setProjectFiles] = useState<string[] | null>(null);
  useEffect(() => {
    setProjectFiles(null);
  }, [docPath, workspaceRoot]);
  useEffect(() => {
    if (!mentionMenuOpen || projectFiles !== null) return;
    let cancelled = false;
    ai.listProjectFiles(docPath, workspaceRoot)
      .then((files) => !cancelled && setProjectFiles(files ?? []))
      .catch(() => !cancelled && setProjectFiles([]));
    return () => {
      cancelled = true;
    };
  }, [mentionMenuOpen, projectFiles, docPath, workspaceRoot]);
  const matchingFiles = mentionQuery
    ? (projectFiles ?? [])
        .filter((path) =>
          path.toLowerCase().includes(mentionQuery[1].toLowerCase()),
        )
        .slice(0, FILE_LIMIT)
    : [];

  async function pickFile(path: string) {
    setInput((prev) => prev.replace(MENTION_TOKEN, "$1"));
    setPickerIndex(0);
    setAttachError(null);
    try {
      const content = await ai.readProjectFile(docPath, workspaceRoot, path);
      setAttachments((prev) =>
        prev.some((f) => f.kind === "text" && f.name === path)
          ? prev
          : [...prev, { kind: "text", name: path, content, truncated: false }],
      );
    } catch (err) {
      setAttachError(errorText(err));
    }
    inputRef.current?.focus();
  }

  // Skill picker: open while the input is a single /token still being typed
  // (no space yet), filtered by that prefix. Purely derived from the input,
  // so it closes itself once the name is completed or the slash is deleted.
  function pickSkill(skill: PickerSkill) {
    setInput(`/${skill.name} `);
    setPickerIndex(0);
  }

  // What the open picker shows: its sections of rows, or the lines that
  // explain an empty one. Never nothing - an empty menu that rendered
  // nothing looked like a dead key.
  let pickerSections: PickerSection[] = [];
  let pickerEmpty: string[] = [];
  if (skillMenuOpen && skillTrigger) {
    const query = skillTrigger[1];
    const row = (skill: PickerSkill): PickerRow => ({
      key: skill.name,
      primary: skill.label ?? `/${skill.name}`,
      secondary: skill.label ? `/${skill.name}` : undefined,
      detail: skill.hint || undefined,
      pick: () => pickSkill(skill),
    });
    pickerSections = query
      ? [{ rows: matchSkills(available, query, recent).map(row) }]
      : groupSkills(available, recent).map((group) => ({
          title: picker.groups[group.id],
          rows: group.skills.map(row),
        }));
    pickerEmpty =
      available.length === 0
        ? [picker.skillAbout, picker.skillHowTo]
        : [picker.skillNoMatch.replace("{query}", query), picker.skillHowTo];
  } else if (mentionMenuOpen && mentionQuery) {
    pickerSections = [
      {
        rows: matchingFiles.map((path) => ({
          key: path,
          primary: `@${basename(path)}`,
          // The folder, when there is one - for a file at the project root
          // the name already says it all.
          detail:
            path !== basename(path)
              ? path.slice(0, path.length - basename(path).length)
              : undefined,
          pick: () => void pickFile(path),
        })),
      },
    ];
    pickerEmpty =
      projectFiles === null
        ? [picker.mentionAbout]
        : projectFiles.length > 0
          ? [picker.mentionNoMatch.replace("{query}", mentionQuery[1])]
          : [
              picker.mentionAbout,
              !docPath && !workspaceRoot
                ? picker.mentionNoProject
                : picker.mentionNoFiles,
            ];
  }
  const pickerRows = pickerSections.flatMap((s) => s.rows);
  const pickerOpen = skillMenuOpen || mentionMenuOpen;
  const activePickerIndex = Math.min(
    pickerIndex,
    Math.max(0, pickerRows.length - 1),
  );

  /** The skill a typed /word names, by its name or any alias. */
  const resolveName = (token: string) => resolveSkillName(token, available);

  function submit() {
    const typed = input.trim();
    const message = resolveSkillMessage(typed, skills, resolveName);
    if (!message || busy) return;
    if (message !== typed) {
      const token = SKILL_COMMAND.exec(typed)?.[1];
      const name = token
        ? skills.some((s) => s.name === token)
          ? token
          : resolveName(token)
        : null;
      if (name) {
        rememberSkill(name);
        refreshRecent();
      }
    }
    setInput("");
    const staged = attachments;
    setAttachments([]);
    onSend(message, staged, !selectionDropped, { mode, webSearch, thinking });
    if (selectionPerMessage && selectedText) setDroppedSelection(selectedText);
    if (message !== typed) onSkillUsed?.();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // Keys pressed while an IME composition is active belong to the IME
    // (Enter confirms the composed characters, arrows navigate candidates) -
    // acting on them here sent half-typed CJK messages. WebKit can also fire
    // the confirming keydown just after compositionend with isComposing
    // already false but the legacy keyCode still 229, so check both.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // While a picker is open, the navigation keys drive it instead of the
    // chat (Enter completes the name rather than sending), and Escape
    // closes it rather than the chat.
    if (pickerOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDismissedInput(input);
        return;
      }
      if (pickerRows.length > 0) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const delta = e.key === "ArrowDown" ? 1 : -1;
          setPickerIndex(
            (activePickerIndex + delta + pickerRows.length) % pickerRows.length,
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          pickerRows[activePickerIndex].pick();
          return;
        }
      } else if (e.key === "Enter" && skillMenuOpen && !skillTrigger?.[1]) {
        // A lone "/" is a question to the menu, not a message.
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") onEscape();
  }

  const modeLabels: Record<AgentMode, string> = {
    write: labels.modeWrite,
    review: labels.modeReview,
    revise: labels.modeRevise,
  };
  const modes = offeredModes.map((m) => [m, modeLabels[m]] as const);

  // On a phone, the composer's buttons leave focus - and so the keyboard -
  // in the textarea: a tap's default is to blur it, which drops the
  // keyboard under the finger mid-message (and moves the docked Quick Ask
  // with it). The click still runs.
  const holdFocus = phone
    ? { onMouseDown: (e: React.MouseEvent) => e.preventDefault() }
    : {};

  const showSelection = !!selectedText && !selectionDropped;
  const [chipHot, setChipHot] = useState(false);
  const chipHandlers = useLatest(selectionChip);
  const chip = { shown: showSelection, hot: showSelection && chipHot };
  useEffect(() => {
    chipHandlers.current?.onChange(chip);
    // Reported by value; the handlers are read through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chip.shown, chip.hot, selectedText]);
  // Gone with the composer: the panel closed, another tab came forward.
  useEffect(
    () => () => chipHandlers.current?.onChange({ shown: false, hot: false }),
    [chipHandlers],
  );
  const dropSelectionButton = (
    <Tooltip text={labels.dropSelection} side="above">
      <button
        type="button"
        className="inline-chat-chip-remove"
        aria-label={labels.dropSelection}
        {...holdFocus}
        onClick={() => setDroppedSelection(selectedText)}
      >
        <CloseIcon />
      </button>
    </Tooltip>
  );

  return (
    <>
      {pickerOpen && (
        <ComposerPicker
          kind={skillMenuOpen ? "skill" : "mention"}
          label={labels.placeholder}
          sections={pickerSections}
          empty={pickerEmpty}
          active={activePickerIndex}
          keys={phone ? null : picker.keys}
        />
      )}
      {dockActions !== undefined && (
        <div className="quick-ask-dock-head">
          {/* The passage itself, on one line, rather than a count of its
              characters: on a phone the keyboard and this panel cover most
              of the document, so the panel says what it is about. */}
          <span className="quick-ask-dock-quote">
            {showSelection ? selectedText : labels.atCursor}
          </span>
          {showSelection && dropSelectionButton}
          <span className="quick-ask-dock-actions">{dockActions}</span>
        </div>
      )}
      <div className="inline-chat-bar">
        {attachError && (
          <div className="inline-chat-attach-error">{attachError}</div>
        )}
        {/* The field: what is attached, the text and its controls, one box
            in the panel and the detached window (inline-chat.css). */}
        <div className="inline-chat-field">
          {attachments.length > 0 && (
            <div className="inline-chat-attachments">
              {attachments.map((file, i) => (
                <span key={i} className="inline-chat-attachment">
                  {/* The two kinds reach the model in completely different
                    ways - extracted text in the prompt, or a native image
                    part - so the chip says which this is. */}
                  {file.kind === "image" ? (
                    <ImageFileIcon className="inline-chat-attachment-kind" />
                  ) : (
                    <GenericFileIcon className="inline-chat-attachment-kind" />
                  )}
                  {file.name}
                  {/* A file cut at the extraction cap must say so - otherwise
                    a partial answer looks like the model misread the whole
                    document rather than having seen only part of it. */}
                  {file.kind === "text" && file.truncated && (
                    <span className="inline-chat-attachment-note">
                      {labels.attachmentTruncated}
                    </span>
                  )}
                  <button
                    className="inline-chat-attachment-remove"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, j) => j !== i))
                    }
                  >
                    <CloseIcon />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            className="inline-chat-input"
            rows={1}
            placeholder={labels.placeholder}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setPickerIndex(0);
            }}
            onKeyDown={onKeyDown}
            autoFocus={focusOnOpen}
          />
          <div className="inline-chat-toolbar">
            {phone ? (
              // Three short words: they all fit in a row, and a
              // segmented control shows which one is on and switches in one
              // tap, where a select is a trip through the system's picker.
              <div
                className="chat-mode-segments"
                role="radiogroup"
                aria-label={labels.modeLabel}
              >
                {modes.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={mode === value}
                    className="chat-mode-segment"
                    {...holdFocus}
                    onClick={() => setMode(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <Select
                className="inline-chat-mode"
                value={mode}
                aria-label={labels.modeLabel}
                onChange={(event) => setMode(event.target.value as AgentMode)}
              >
                {modes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
            {!compact && (
              <>
                <Tooltip text={labels.attachFile} side="above">
                  <button
                    className="inline-chat-attach"
                    aria-label={labels.attachFile}
                    onClick={attachFile}
                  >
                    <PlusIcon />
                  </button>
                </Tooltip>
                <Tooltip
                  side="above"
                  description={
                    webSearch && searchUnavailable
                      ? labels.webSearchNeedsService
                      : null
                  }
                  text={
                    webSearch && searchUnavailable
                      ? labels.webSearchNeedsService
                      : webSearch
                        ? labels.toggleOnHint.replace(
                            "{label}",
                            labels.webSearch,
                          )
                        : labels.webSearch
                  }
                >
                  <button
                    type="button"
                    className={`inline-chat-toggle inline-chat-web-search${webSearch ? " is-active" : ""}${
                      webSearch && searchUnavailable ? " needs-setup" : ""
                    }`}
                    aria-label={labels.webSearch}
                    aria-pressed={webSearch}
                    {...holdFocus}
                    onClick={() => setWebSearch((value) => !value)}
                  >
                    <SearchIcon />
                  </button>
                </Tooltip>
                {canThinkDeeper && (
                  <Tooltip
                    side="above"
                    description={labels.deepThinkingHint}
                    text={
                      deepThinking
                        ? labels.toggleOnHint.replace(
                            "{label}",
                            labels.deepThinkingHint,
                          )
                        : labels.deepThinkingHint
                    }
                  >
                    <button
                      type="button"
                      className={`inline-chat-toggle inline-chat-deep-thinking${deepThinking ? " is-active" : ""}`}
                      aria-label={labels.deepThinking}
                      aria-pressed={deepThinking}
                      {...holdFocus}
                      onClick={() => {
                        rememberDeepThinking(!deepThinking);
                        setDeepThinking(!deepThinking);
                      }}
                    >
                      <LightbulbIcon />
                    </button>
                  </Tooltip>
                )}
              </>
            )}
            {selectedText && !selectionDropped && dockActions === undefined && (
              <span
                className="inline-chat-selection-chip"
                onMouseEnter={() => setChipHot(true)}
                onMouseLeave={() => setChipHot(false)}
              >
                <button
                  type="button"
                  className="inline-chat-chip-label"
                  title={labels.showSelection}
                  {...holdFocus}
                  onClick={() => selectionChip?.onReveal()}
                >
                  {selectionIsPicture
                    ? labels.selectedPicture
                    : labels.selectedChars([...selectedText].length)}
                </button>
                {dropSelectionButton}
              </span>
            )}
            <button
              className="inline-chat-send"
              {...holdFocus}
              onClick={busy ? onStop : submit}
              disabled={!busy && !input.trim()}
            >
              {busy ? labels.stop : labels.send}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
