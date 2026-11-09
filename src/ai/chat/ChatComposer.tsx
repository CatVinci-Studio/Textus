import { MentionLayer, useMentions } from "./composer-mentions";
import { AttachmentChips } from "./AttachmentChips";
import { prepareList, rankList } from "../../utils/list-filter";
import { resolveSkillMessage } from "./proposal";
import { ai } from "../../platform/ipc";
import { ComposerPicker } from "./ComposerPicker";
import {
  MENTION_TOKEN,
  MENTION_TRIGGER,
  SKILL_COMMAND,
  rememberSkill,
  resolveSkillName,
  type PickerSkill,
} from "./skill-picker";
import { basename } from "../../utils/path";
import type { PanelMode } from "../../prefs/SettingsContext";
import { ArrowUpIcon, CloseIcon, PlusIcon, StopIcon } from "../../ui/icons";
import { ComposerToggles, KindChip } from "./ComposerTools";
import { ModeAndModelPicker, ModePicker, type ModeChoice } from "./ModePicker";
import { Tooltip } from "../../ui/Tooltip";
import { FollowUpChips } from "./FollowUpChips";
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
import { pickerContent } from "./composer-picker-content";

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
/** The project's files `query` finds by the shared list filter: by name
 *  first, then anywhere in the path. */
function matchFiles(paths: string[], query: string): string[] {
  const list = prepareList(
    paths.map((path) => ({ label: basename(path), keywords: path, path })),
  );
  return rankList(list, query, Infinity).map((entry) => entry.path);
}

export function ChatComposer({
  docPath,
  workspaceRoot,
  conversation,
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
  onlyMode,
  focusOnOpen = true,
  defaultWebSearch,
  dockActions,
  switchModels = false,
  onSend,
  onStop,
  onEscape,
  onModeChange,
  onResearch,
  kind = null,
  kinds = [],
  autoTools = false,
  handle,
  suggestions = [],
}: ChatComposerProps) {
  const phone = usePhoneLayout();
  const picker = labels.picker ?? defaultPickerLabels();
  const typing = useComposerInput(handle);
  const { input, setInput, pickerIndex, setPickerIndex, inputRef } = typing;
  const { dismissedInput, setDismissedInput } = typing;
  const staged = useAttachments(labels.attachmentNoVision, conversation);
  const { attachments, setAttachments, attachError, setAttachError } = staged;
  const mentions = useMentions(input, setInput, setAttachments, inputRef);
  // Research is the panel's, where its paper is followed. Create is made in
  // Settings › Extensions, so it is offered only where it is the one mode.
  const modeValues: readonly PanelMode[] = onlyMode
    ? [onlyMode]
    : ["write", "review", ...(onResearch ? (["research"] as const) : [])];
  const { mode, setMode } = useComposerMode({
    tourMode,
    carryMode,
    defaultMode,
    offered: modeValues,
    onModeChange,
  });
  const options = useRequestOptions(defaultWebSearch, compact);
  // Create always searches and thinks deeper, where the model can.
  const webSearch = autoTools || options.webSearch;
  const thinking =
    autoTools && options.canThinkDeeper ? "deep" : options.thinking;
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
    // Research has no skills: the message is a paper's topic.
    mode: mode === "research" ? null : mode,
  });

  // @-mention picker ("@", or the "＠" a CJK IME types): picking a project
  // file attaches it, its "@query" turned into the file's chip. Fetched on
  // the first "@".
  const mentionQuery = skillTrigger ? null : MENTION_TRIGGER.exec(input);
  const mentionMenuOpen = !!mentionQuery && dismissedInput !== input;
  const projectFiles = useProjectFiles(mentionMenuOpen, docPath, workspaceRoot);
  const matchingFiles = mentionQuery
    ? matchFiles(projectFiles ?? [], mentionQuery[1]).slice(0, FILE_LIMIT)
    : [];

  async function pickFile(path: string) {
    mentions.add(path, MENTION_TOKEN);
    setPickerIndex(0);
    setAttachError(null);
    try {
      const content = await ai.readProjectFile(docPath, workspaceRoot, path);
      setAttachments((prev) =>
        prev.some((f) => f.kind === "text" && f.name === path)
          ? prev
          : [
              ...prev,
              { kind: "text", name: path, content, truncated: false, path },
            ],
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
  const { sections: pickerSections, empty: pickerEmpty } = pickerContent({
    skillTrigger: skillMenuOpen ? skillTrigger : null,
    mentionQuery: mentionMenuOpen ? mentionQuery : null,
    kinds,
    available,
    recent,
    matchingFiles,
    projectFiles,
    hasProject: !!docPath || !!workspaceRoot,
    labels: picker,
    pickKind: (k) => {
      setInput("");
      setPickerIndex(0);
      k.pick();
    },
    pickSkill,
    pickFile: (path) => void pickFile(path),
  });
  const pickerRows = pickerSections.flatMap((s) => s.rows);
  const pickerOpen = skillMenuOpen || mentionMenuOpen;
  const activePickerIndex = Math.min(
    pickerIndex,
    Math.max(0, pickerRows.length - 1),
  );

  /** The skill a typed /word names, by its name or any alias. */
  const resolveName = (token: string) => resolveSkillName(token, available);

  /** Sends what is typed, or a suggested next message picked instead. */
  function submit(text: string = input) {
    const typed = text.trim();
    if (mode === "research") {
      if (!typed || busy || !onResearch) return;
      setInput("");
      setAttachments([]);
      onResearch(typed, attachments);
      return;
    }
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

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Keys during an IME composition belong to the IME. WebKit can fire the
    // confirming keydown after compositionend with isComposing false but
    // keyCode still 229, so check both.
    if (isImeKeydown(e)) return;
    if (mentions.onKeyDown(e)) return;
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

  // The suggested next messages, while the box is empty: the likeliest grey
  // in it, all as buttons over it (not in Quick Ask's one-line box).
  const followUps = !busy && input === "" ? suggestions : [];
  const offered = followUps[0] ?? null;

  const modes: ModeChoice[] = modeValues.map((value) => ({
    value,
    ...labels.modes[value],
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
      {!compact && followUps.length > 0 && (
        <FollowUpChips
          suggestions={followUps}
          label={labels.followUps}
          holdFocus={phone}
          onPick={submit}
        />
      )}
      <div className="inline-chat-bar">
        {attachError && (
          <div className="inline-chat-attach-error">{attachError}</div>
        )}
        {/* The field: what is attached, the text and its controls, one box. */}
        <div className="inline-chat-field">
          <AttachmentChips
            attachments={attachments}
            mentioned={mentions.paths}
            setAttachments={setAttachments}
            truncatedLabel={labels.attachmentTruncated}
          />
          <div className="inline-chat-input-wrap">
            <MentionLayer
              input={input}
              paths={mentions.paths}
              textarea={inputRef}
            />
            <textarea
              ref={inputRef}
              className={`inline-chat-input${offered ? " inline-chat-input-suggested" : ""}`}
              rows={1}
              placeholder={
                offered
                  ? `${offered}  (${labels.suggestionTab})`
                  : mode === "research"
                    ? labels.researchPlaceholder
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
          </div>
          <div className="inline-chat-toolbar">
            {switchModels && !mobileChrome() ? (
              <ModeAndModelPicker {...pickerProps} />
            ) : (
              <ModePicker {...pickerProps} holdFocus={phone} />
            )}
            {!compact && (
              <Tooltip text={labels.attachFile} side="above">
                <button
                  className="inline-chat-attach"
                  aria-label={labels.attachFile}
                  onClick={staged.attachFile}
                >
                  <PlusIcon />
                </button>
              </Tooltip>
            )}
            {kind && <KindChip kind={kind} holdFocus={holdFocus} />}
            {/* A paper does its own searching and thinking, and Create
                always searches and thinks: no buttons for them there. */}
            {!compact && mode !== "research" && !autoTools && (
              <ComposerToggles
                labels={labels}
                options={options}
                holdFocus={holdFocus}
              />
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
              aria-label={busy ? labels.stop : labels.send}
              {...holdFocus}
              onClick={busy ? onStop : () => submit()}
              disabled={!busy && !input.trim()}
            >
              {busy ? (
                <StopIcon className="inline-chat-send-icon" />
              ) : (
                <ArrowUpIcon className="inline-chat-send-icon" />
              )}
              <span className="inline-chat-send-label">
                {busy ? labels.stop : labels.send}
              </span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
