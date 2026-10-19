import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentSkill, ChatAttachment } from "../types";
import { resolveSkillMessage } from "./proposal";
import { ai, type SkillListItem } from "../../platform/ipc";
import { resolveStrings } from "../../i18n/strings";
import {
  ComposerPicker,
  pickerLabels,
  type PickerLabels,
  type PickerRow,
  type PickerSection,
} from "./ComposerPicker";
import {
  MENTION_TOKEN,
  MENTION_TRIGGER,
  SKILL_COMMAND,
  SKILL_TRIGGER,
  groupSkills,
  listFromWorkspace,
  matchSkills,
  pickerSkills,
  recentSkills,
  rememberSkill,
  resolveSkillName,
  type PickerSkill,
} from "./skill-picker";
import { errorText } from "../../utils/error-text";
import { basename } from "../../utils/path";
import { useActiveProvider } from "../provider-catalog";
import type { AgentMode } from "../../settings/SettingsContext";
import { InlineDictation } from "../../voice/InlineDictation";
import { initialMode, rememberMode } from "./last-mode";
import {
  ArrowUpIcon,
  CloseIcon,
  GenericFileIcon,
  ImageFileIcon,
  PaperclipIcon,
  PlusIcon,
  SearchIcon,
} from "../../ui/icons";
import { ComposerMenu, type ComposerMenuItem } from "./ComposerMenu";
import { Select } from "../../ui/Select";
import { usePhoneLayout } from "../../ui/usePhoneLayout";
import { modalDialogOpen } from "../../ui/useModalDialog";

export interface ChatComposerLabels {
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
  /** Suffix on an attachment chip whose text was cut at the extraction cap. */
  attachmentTruncated: string;
  /** Shown when an image is attached but the active provider has no vision. */
  attachmentNoVision: string;
  modeAsk: string;
  modeEdit: string;
  modePlan: string;
  modeCreate?: string;
  /** Accessible name of the phone's segmented mode control. */
  modeLabel: string;
  webSearch: string;
  /** The `/` and `@` pickers' words; English when left out. */
  picker?: PickerLabels;
}

let englishPicker: PickerLabels | null = null;
function defaultPickerLabels(): PickerLabels {
  englishPicker ??= pickerLabels(resolveStrings("en"), "en");
  return englishPicker;
}

/** How many matching project files the `@` picker lists. */
const FILE_LIMIT = 30;

interface ChatComposerProps {
  /** Resolves the agent workspace (skills) - re-loaded whenever it changes. */
  docPath: string | null;
  /** Explicit workspace root, or null for the document's own folder. Skills
   *  come from whichever it resolves to. */
  workspaceRoot: string | null;
  selectedText: string | null;
  busy: boolean;
  labels: ChatComposerLabels;
  defaultMode: AgentMode;
  /** The panel and the detached window: the mode picked carries over to
   *  the next conversation (last-mode.ts). Quick Ask keeps its own. */
  carryMode?: boolean;
  /** Whether Plan is offered. Quick Ask, a command bar for changing the
   *  text in front of you, leaves it out - planning belongs in the full
   *  conversation. */
  allowPlan?: boolean;
  allowCreate?: boolean;
  voiceLanguage?: string;
  active?: boolean;
  /** Quick Ask: no attach or web-search buttons - those stay in the panel
   *  (an @-mention still attaches a project file). */
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
  /** The host's own entries in the "+" menu (the Agent's project folder,
   *  image switch and auto-writing), after the composer's own. */
  menuItems?: ComposerMenuItem[];
  /** The resolved message (skill expanded) plus any attachments - InlineChat
   *  owns tagging it with selected-text/chatInfo and actually sending it. */
  onSend: (
    message: string,
    attachments: ChatAttachment[],
    /** False once the user has removed the selection chip. */
    includeSelection: boolean,
    options: { mode: AgentMode; webSearch: boolean },
  ) => boolean | void;
  onStop: () => void;
  onEscape: () => void;
}

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
  busy,
  labels,
  defaultMode,
  carryMode = false,
  allowPlan = true,
  allowCreate = false,
  voiceLanguage = "en",
  active = true,
  compact = false,
  focusOnOpen = true,
  defaultWebSearch,
  dockActions,
  menuItems = [],
  onSend,
  onStop,
  onEscape,
}: ChatComposerProps) {
  const phone = usePhoneLayout();
  // Derived here rather than passed in: this is the only place an image can
  // be staged, so deriving it at the gate makes it impossible for a caller to
  // forget - which is exactly what happened when it was a prop, leaving Quick
  // Ask happy to attach an image to a provider that can't read one.
  const supportsVision = useActiveProvider()?.supportsVision ?? true;
  const picker = labels.picker ?? defaultPickerLabels();
  const [input, setInput] = useState("");
  const [pickerIndex, setPickerIndex] = useState(0);
  // Escape closes a picker for the input as it stands; typing reopens it.
  const [dismissedInput, setDismissedInput] = useState<string | null>(null);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [skillList, setSkillList] = useState<SkillListItem[] | null>(null);
  const [recent, setRecent] = useState<string[]>(recentSkills);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [mode, setModeState] = useState<AgentMode>(() => {
    const saved = carryMode ? initialMode(defaultMode) : defaultMode;
    return saved === "create" && !allowCreate ? "edit" : saved;
  });
  const setMode = (next: AgentMode) => {
    setModeState(next);
    if (carryMode) rememberMode(next, defaultMode);
  };
  const [webSearch, setWebSearch] = useState(defaultWebSearch);
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
  const plusRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Skills come from the agent workspace on disk (global dir + the workspace
  // root's .textus/skills). Loaded fresh each time the chat opens, so editing
  // a skill file takes effect on the next chat without a restart.
  useEffect(() => {
    let cancelled = false;
    ai.loadAgentWorkspace(docPath, workspaceRoot)
      .then((ws) => {
        if (!cancelled && ws?.skills) setSkills(ws.skills);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docPath, workspaceRoot]);

  // The `/` menu's list - built-ins included, with their groups and which
  // are on - fetched again each time the menu opens, so a skill turned off
  // in Settings a moment ago is already gone from it.
  const skillTrigger = SKILL_TRIGGER.exec(input);
  const skillMenuOpen = !!skillTrigger && dismissedInput !== input;
  useEffect(() => {
    if (!skillMenuOpen) return;
    let cancelled = false;
    ai.listSkills(docPath, workspaceRoot)
      .then((list) => {
        if (!cancelled) setSkillList(Array.isArray(list) ? list : null);
      })
      .catch(() => {
        if (!cancelled) setSkillList(null);
      });
    return () => {
      cancelled = true;
    };
  }, [skillMenuOpen, docPath, workspaceRoot]);

  // The list, plus any workspace skill it lacks (an older backend lists
  // none): what the menu offers and what a typed /word resolves against.
  const available: PickerSkill[] = useMemo(() => {
    const listed = skillList ?? [];
    const names = new Set(listed.map((s) => s.name));
    const extra = listFromWorkspace(skills.filter((s) => !names.has(s.name)));
    return pickerSkills([...listed, ...extra], picker.lang);
  }, [skillList, skills, picker.lang]);

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
        setRecent(recentSkills());
      }
    }
    // false = the host is not ready (e.g. still restoring a draft): keep the
    // typed prompt instead of silently discarding it.
    if (
      onSend(message, attachments, !selectionDropped, { mode, webSearch }) ===
      false
    )
      return;
    setInput("");
    setAttachments([]);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // Keys pressed while an IME composition is active belong to the IME
    // (Enter confirms the composed characters, arrows navigate candidates) -
    // acting on them here sent half-typed CJK messages. WebKit can also fire
    // the confirming keydown just after compositionend with isComposing
    // already false but the legacy keyCode still 229, so check both.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // A picked skill reads as one token: Backspace right after "/name"
    // (or "/name ") takes the whole name, not its last letter.
    if (e.key === "Backspace" && !e.altKey && !e.metaKey && !e.ctrlKey) {
      const el = inputRef.current;
      const caret = el?.selectionStart ?? 0;
      if (el && caret === el.selectionEnd) {
        const token = /^[/／、・](\S+)\s?$/.exec(input.slice(0, caret));
        if (token && resolveName(token[1])) {
          e.preventDefault();
          setInput(input.slice(caret).replace(/^\s+/, ""));
          setPickerIndex(0);
          requestAnimationFrame(() => el.setSelectionRange(0, 0));
          return;
        }
      }
    }
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

  const modes: [AgentMode, string][] = [
    ["ask", labels.modeAsk],
    ["edit", labels.modeEdit],
    ...(allowCreate
      ? [["create", labels.modeCreate ?? "Create"] as [AgentMode, string]]
      : []),
    ...(allowPlan ? [["plan", labels.modePlan] as [AgentMode, string]] : []),
  ];

  // On a phone, the composer's buttons leave focus - and so the keyboard -
  // in the textarea: a tap's default is to blur it, which drops the
  // keyboard under the finger mid-message (and moves the docked Quick Ask
  // with it). The click still runs.
  const holdFocus = phone
    ? { onMouseDown: (e: React.MouseEvent) => e.preventDefault() }
    : {};

  // The "+" menu's own words; the rest come from the labels.
  const zh = picker.lang.startsWith("zh");
  const words = zh
    ? {
        menu: "添加内容和工具",
        add: "添加",
        mode: "模式",
        modeHints: {
          ask: "只回答问题，不改文档",
          edit: "修改当前文档，审阅后应用",
          create: "从头写作，可配图",
          plan: "先列计划，确认后执行",
        },
        tools: "工具",
        file: "文件和图片",
        fileHint: "PDF、Word、表格、图片…",
        mention: "引用项目文件",
        mentionHint: "也可以直接输入 @",
        skill: "使用技能",
        skillHint: "也可以直接输入 /",
        skillBusy: "清空输入框后可用",
        webHint: "需要时让 AI 搜索网络",
        off: "点击关闭",
      }
    : {
        menu: "Add content and tools",
        add: "Add",
        mode: "Mode",
        modeHints: {
          ask: "Answers only; the document stays as is",
          edit: "Changes this document, after your review",
          create: "Writes from scratch, with images if allowed",
          plan: "A plan first, carried out once you agree",
        },
        tools: "Tools",
        file: "Files and images",
        fileHint: "PDF, Word, sheets, images…",
        mention: "Project file",
        mentionHint: "or type @",
        skill: "Use a skill",
        skillHint: "or type /",
        skillBusy: "Clear the message first",
        webHint: "Let the AI search when it needs to",
        off: "Click to turn off",
      };
  /** Types `@` or `/` for the user: the same pickers open as when typed. */
  const typeTrigger = (char: "@" | "/") => {
    setInput((prev) =>
      char === "/" ? "/" : `${prev}${prev && !/\s$/.test(prev) ? " " : ""}@`,
    );
    setDismissedInput(null);
    setPickerIndex(0);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  };
  const ownItems: ComposerMenuItem[] = [
    {
      key: "file",
      section: "add",
      icon: <PaperclipIcon />,
      label: words.file,
      hint: words.fileHint,
      select: () => void attachFile(),
    },
    {
      key: "mention",
      section: "add",
      icon: <span className="composer-menu-glyph">@</span>,
      label: words.mention,
      hint: words.mentionHint,
      select: () => typeTrigger("@"),
    },
    {
      key: "web",
      section: "tools",
      icon: <SearchIcon />,
      label: labels.webSearch,
      hint: words.webHint,
      on: webSearch,
      select: () => setWebSearch((value) => !value),
    },
  ];
  const skillItem: ComposerMenuItem = {
    key: "skill",
    section: "tools",
    icon: <span className="composer-menu-glyph">/</span>,
    label: words.skill,
    hint: input.trim() ? words.skillBusy : words.skillHint,
    disabled: !!input.trim(),
    select: () => typeTrigger("/"),
  };
  // On a desktop the modes live in "+" too (the phone keeps its segmented
  // control, Quick Ask - which has no "+" - its select).
  const modesInMenu = !compact && !phone;
  const modeItems: ComposerMenuItem[] = modesInMenu
    ? modes.map(([value, label]) => ({
        key: `mode-${value}`,
        section: "mode",
        icon: <ModeIcon mode={value} />,
        label,
        hint: words.modeHints[value],
        selected: mode === value,
        select: () => setMode(value),
      }))
    : [];
  const allItems = [...ownItems, ...modeItems, ...menuItems, skillItem];
  const switchesOn = allItems.filter((item) => item.on);

  const showSelection = !!selectedText && !selectionDropped;
  const dropSelectionButton = (
    <button
      type="button"
      className="inline-chat-chip-remove"
      aria-label={labels.dropSelection}
      title={labels.dropSelection}
      {...holdFocus}
      onClick={() => setDroppedSelection(selectedText)}
    >
      <CloseIcon />
    </button>
  );

  return (
    <>
      {pickerOpen && (compact || phone) && (
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
        {/* The panel's, window's and Agent's pickers float like "+" does;
            Quick Ask's sits in its card above the field, and a phone's
            above the field in its sheet (under the sheet's handle). */}
        {pickerOpen && !compact && !phone && (
          <ComposerPicker
            kind={skillMenuOpen ? "skill" : "mention"}
            label={labels.placeholder}
            sections={pickerSections}
            empty={pickerEmpty}
            active={activePickerIndex}
            keys={phone ? null : picker.keys}
            floating
          />
        )}
        {menuOpen && (
          <ComposerMenu
            label={words.menu}
            trigger={plusRef}
            sections={[
              {
                title: words.add,
                items: allItems.filter((item) => item.section === "add"),
              },
              {
                title: words.mode,
                items: allItems.filter((item) => item.section === "mode"),
              },
              {
                title: words.tools,
                items: allItems.filter(
                  (item) => item.section !== "add" && item.section !== "mode",
                ),
              },
            ]}
            onClose={(refocus) => {
              setMenuOpen(false);
              if (refocus) plusRef.current?.focus();
            }}
          />
        )}
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
            // Not out of an open dialog: a tab opened behind Settings
            // (closing a deleted skill copy's tab) used to steal Escape.
            autoFocus={focusOnOpen && !modalDialogOpen()}
          />
          <div className="inline-chat-toolbar">
            {/* "+" leads the row: everything to add, and the tools. */}
            {!compact && (
              <button
                ref={plusRef}
                type="button"
                className="inline-chat-attach"
                title={words.menu}
                aria-label={words.menu}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                {...holdFocus}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <PlusIcon />
              </button>
            )}
            {modesInMenu && (
              <button
                type="button"
                className="composer-chip is-mode"
                aria-label={`${labels.modeLabel}: ${modes.find(([value]) => value === mode)?.[1] ?? mode}`}
                aria-haspopup="menu"
                onClick={() => setMenuOpen(true)}
              >
                <span className="composer-chip-icon" aria-hidden="true">
                  <ModeIcon mode={mode} />
                </span>
                {modes.find(([value]) => value === mode)?.[1]}
              </button>
            )}
            {!compact &&
              switchesOn.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="composer-chip"
                  aria-pressed="true"
                  title={`${item.label} · ${words.off}`}
                  disabled={item.disabled}
                  {...holdFocus}
                  onClick={item.select}
                >
                  <span className="composer-chip-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.chip ?? item.label}
                </button>
              ))}
            {selectedText && !selectionDropped && dockActions === undefined && (
              <span className="inline-chat-selection-chip">
                {labels.selectedChars([...selectedText].length)}
                {dropSelectionButton}
              </span>
            )}
            <span className="inline-chat-toolbar-spacer" />
            {modesInMenu ? null : phone ? (
              // Two or three short words: they all fit in a row, and a
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
              <InlineDictation
                active={active && !busy}
                language={voiceLanguage}
                value={input}
                inputRef={inputRef}
                onChange={setInput}
              />
            )}
            <button
              className={`inline-chat-send${busy ? " is-stop" : ""}`}
              aria-label={busy ? labels.stop : labels.send}
              title={busy ? labels.stop : labels.send}
              {...holdFocus}
              onClick={busy ? onStop : submit}
              disabled={!busy && !input.trim()}
            >
              {busy ? (
                <span className="inline-chat-stop-mark" aria-hidden="true" />
              ) : (
                <ArrowUpIcon />
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Each mode's glyph in the "+" menu and on its chip. */
function ModeIcon({ mode }: { mode: AgentMode }) {
  const paths: Record<AgentMode, ReactNode> = {
    ask: (
      <>
        <path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.1A8.5 8.5 0 1 1 21 12Z" />
        <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.4" />
        <path d="M12 16.6h.01" />
      </>
    ),
    edit: (
      <>
        <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
        <path d="m13.5 6.5 4 4" />
      </>
    ),
    create: (
      <>
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
        <path d="m6.3 6.3 2.1 2.1M15.6 15.6l2.1 2.1M6.3 17.7l2.1-2.1M15.6 8.4l2.1-2.1" />
      </>
    ),
    plan: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2" />
        <circle cx="5" cy="18" r="1.2" />
      </>
    ),
  };
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[mode]}
    </svg>
  );
}
