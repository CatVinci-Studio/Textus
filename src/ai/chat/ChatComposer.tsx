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
import { basename } from "../../utils/path";
import { AGENT_MODES, type AgentMode } from "../../prefs/SettingsContext";
import {
  CloseIcon,
  GenericFileIcon,
  ImageFileIcon,
  LightbulbIcon,
  PlusIcon,
  SearchIcon,
} from "../../ui/icons";
import { rememberDeepThinking } from "./deep-thinking";
import { ModeAndModelPicker, ModePicker, type ModeChoice } from "./ModePicker";
import { Tooltip } from "../../ui/Tooltip";
import { usePhoneLayout } from "../../ui/usePhoneLayout";

import { useComposerSkills } from "./useComposerSkills";
import {
  useAttachments,
  useComposerInput,
  useComposerMode,
  useProjectFiles,
  useRequestOptions,
  useSelectionChip,
} from "./useComposerState";
import {
  defaultPickerLabels,
  FILE_LIMIT,
  type ChatComposerProps,
} from "./composer-types";
import { isImeKeydown } from "../../utils/ime";

/** A tablet's sheet has no room for the model: it is picked in Settings
 *  there, as on a phone. */
function mobileChrome() {
  return document.documentElement.dataset.windowChrome === "mobile";
}

export type {
  ChatComposerHandle,
  ChatComposerLabels,
  SelectionChip,
  SelectionChipHandlers,
} from "./composer-types";
import { currentStrings } from "../../i18n/current";
import { explainError } from "../../utils/error-explain";

/**
 * The input row: textarea, attachments, selection chip, send button and the
 * `/` and `@` pickers. Owns its input state; the caller hears only onSend.
 */
export function ChatComposer({
  docPath,
  workspaceRoot,
  selectedText,
  selectionIsPicture = false,
  busy,
  labels,
  defaultMode,
  carryMode = false,
  tourMode = null,
  selectionChip,
  selectionPerMessage = false,
  compact = false,
  focusOnOpen = true,
  defaultWebSearch,
  dockActions,
  switchModels = false,
  onSend,
  onStop,
  onEscape,
  onModeChange,
  handle,
  suggestion = null,
}: ChatComposerProps) {
  const phone = usePhoneLayout();
  const picker = labels.picker ?? defaultPickerLabels();
  const typing = useComposerInput(handle);
  const { input, setInput, pickerIndex, setPickerIndex, inputRef } = typing;
  const { dismissedInput, setDismissedInput } = typing;
  const staged = useAttachments(labels.attachmentNoVision);
  const { attachments, setAttachments, attachError, setAttachError } = staged;
  const { mode, setMode } = useComposerMode({
    tourMode,
    carryMode,
    defaultMode,
    onModeChange,
  });
  const options = useRequestOptions(defaultWebSearch, compact);
  const { searchUnavailable, webSearch, setWebSearch, thinking } = options;
  const { deepThinking, setDeepThinking, canThinkDeeper } = options;
  const { selectionDropped, setDroppedSelection, showSelection, setChipHot } =
    useSelectionChip(selectedText, selectionChip);
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
    mode,
  });

  // @-mention picker ("@", or the "＠" a CJK IME types): picking a project
  // file attaches it and drops the "@query". Fetched on the first "@".
  const mentionQuery = skillTrigger ? null : MENTION_TRIGGER.exec(input);
  const mentionMenuOpen = !!mentionQuery && dismissedInput !== input;
  const projectFiles = useProjectFiles(mentionMenuOpen, docPath, workspaceRoot);
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
      setAttachError(explainError(err, currentStrings()));
    }
    inputRef.current?.focus();
  }

  // Skill picker: open while the input is a single /token with no space yet,
  // so it closes itself once the name is complete or the slash is gone.
  function pickSkill(skill: PickerSkill) {
    setInput(`/${skill.name} `);
    setPickerIndex(0);
  }

  // What the open picker shows. Never nothing: an empty menu looks like a
  // dead key.
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
    // While a reply is coming the message joins the queue.
    if (!message) return;
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
    onSend(
      message,
      staged,
      !selectionDropped,
      { mode, webSearch, thinking },
      typed,
    );
    if (selectionPerMessage && selectedText) setDroppedSelection(selectedText);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // Keys during an IME composition belong to the IME. WebKit can fire the
    // confirming keydown after compositionend with isComposing false but
    // keyCode still 229, so check both.
    if (isImeKeydown(e)) return;
    // While a picker is open, the navigation keys, Enter and Escape drive it
    // instead of the chat.
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
    if (e.key === "Tab" && !e.shiftKey && offered) {
      e.preventDefault();
      setInput(offered);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") onEscape();
  }

  // The suggested next message, while the box is empty.
  const offered = !busy && input === "" ? suggestion : null;

  const modeLabels: Record<AgentMode, [string, string]> = {
    write: [labels.modeWrite, labels.modeWriteHint],
    review: [labels.modeReview, labels.modeReviewHint],
    create: [labels.modeCreate, labels.modeCreateHint],
  };
  // Quick Ask works on the selection: it writes or reviews, never creates.
  const modes: ModeChoice[] = AGENT_MODES.filter(
    (m) => !compact || m !== "create",
  ).map((value) => ({
    value,
    label: modeLabels[value][0],
    hint: modeLabels[value][1],
  }));
  const pickerProps = {
    mode,
    modes,
    onMode: setMode,
    labels: {
      mode: labels.modeLabel,
      model: labels.modelLabel,
      picker: switchModels ? labels.modeAndModelLabel : labels.modeLabel,
    },
  };

  // On a phone the buttons leave focus, and the keyboard, in the textarea:
  // a tap would blur it mid-message. The click still runs.
  const holdFocus = phone
    ? { onMouseDown: (e: React.MouseEvent) => e.preventDefault() }
    : {};

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
          {/* The passage itself, not a count: on a phone the keyboard and
              this panel cover most of the document. */}
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
        {/* The field: what is attached, the text and its controls, one box. */}
        <div className="inline-chat-field">
          {attachments.length > 0 && (
            <div className="inline-chat-attachments">
              {attachments.map((file, i) => (
                <span key={i} className="inline-chat-attachment">
                  {/* Extracted text and a native image part reach the model
                    differently, so the chip says which this is. */}
                  {file.kind === "image" ? (
                    <ImageFileIcon className="inline-chat-attachment-kind" />
                  ) : (
                    <GenericFileIcon className="inline-chat-attachment-kind" />
                  )}
                  {file.name}
                  {/* A file cut at the extraction cap says so, or a partial
                    answer looks like the model misread the document. */}
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
            className={`inline-chat-input${offered ? " inline-chat-input-suggested" : ""}`}
            rows={1}
            placeholder={
              offered
                ? `${offered}  (${labels.suggestionTab})`
                : labels.placeholder
            }
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setPickerIndex(0);
            }}
            onKeyDown={onKeyDown}
            autoFocus={focusOnOpen}
          />
          <div className="inline-chat-toolbar">
            {switchModels && !mobileChrome() ? (
              <ModeAndModelPicker {...pickerProps} />
            ) : (
              <ModePicker {...pickerProps} holdFocus={phone} />
            )}
            {!compact && (
              <>
                <Tooltip text={labels.attachFile} side="above">
                  <button
                    className="inline-chat-attach"
                    aria-label={labels.attachFile}
                    onClick={staged.attachFile}
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
