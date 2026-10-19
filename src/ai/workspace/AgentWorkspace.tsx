import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  resolveImageSrc,
  showDocImage,
} from "../../editor/images/image-plugin";
import { isScopedUrl } from "../../platform/ios-files";
import type { DocumentDraft, DraftOperation } from "./document-draft";
import type { EditProposal } from "../types";
import type { AgentConversation } from "../chat/useAgentConversation";
import { withImageSrc } from "../MarkdownText";
import { renderDocumentHtml } from "../../editor/markdown/render-html";
import { useKatexReady } from "../../editor/math/katex-loader";
import {
  markDraftChanges,
  withChangeActions,
  type ChangeTarget,
  withImagePlaceholders,
  type PendingImage,
} from "./draft-diff";
import { workspaceLabels } from "./labels";
import { userMessageBody } from "../chat/user-message";
import { foldToolSteps, isCardTool, toolStepCounts } from "../chat/tool-steps";
import {
  deleteConversation,
  saveConversation,
  useChatHistory,
  type ChatHistoryEntry,
} from "../chat/chat-history";
import { createPortal } from "react-dom";
import { ContextMenu } from "../../editor/ContextMenu";
import { Presence } from "../../ui/usePresence";
import { parseProposal } from "../chat/proposal";
import { basename } from "../../utils/path";
import { firstLevelOneHeading } from "../../document/save-default-name";
import {
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  HamburgerIcon,
  PlusIcon,
} from "../../ui/icons";
import type { Suggestion } from "./assist";
import {
  NEW_DOCUMENT_EVENT,
  OPEN_TASK_EVENT,
  type OpenTask,
} from "../../document/doc-tabs";
import "./workspace.css";

/** Puts a suggestion into the composer this workspace renders, as if typed. */
function fillComposer(root: HTMLElement | null, text: string) {
  const input = root?.querySelector<HTMLTextAreaElement>(
    "textarea.inline-chat-input",
  );
  if (!input) return;
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
  input.setSelectionRange(text.length, text.length);
}

/** A conversation saved before snapshots existed: its document rebuilt from
 *  the text the Agent proposed to write (appended and inserted passages, in
 *  order) - the best that can be done for an untitled document. */
function textFromProposals(entry: ChatHistoryEntry): string | null {
  const parts: string[] = [];
  for (const turn of entry.turns) {
    if (turn.kind !== "ToolCall" || turn.name !== "propose_edit") continue;
    const proposal = parseProposal(turn.arguments);
    if (
      proposal?.text &&
      ["append", "insert_after", "insert_at_cursor"].includes(proposal.action)
    )
      parts.push(proposal.text.trim());
  }
  return parts.length ? parts.join("\n\n") + "\n" : null;
}

const NO_PENDING_IMAGES: PendingImage[] = [];
const NO_REJECTED: DraftOperation[] = [];
/** An auto-writing section's request (auto-writer.ts's sectionPrompt). */
const AUTO_SECTION_LINE =
  /^(?:【自动写作 (\d+)\/(\d+)】|\[Auto-writing (\d+)\/(\d+)\])/;
const ALWAYS_SETTLED = () => true;
/** Changes whose paragraphs can be taken one at a time: text added at
 *  the end (useDocumentWorkspace's explode says why only that). */
const INSERTS = new Set(["append"]);
const TASKS_HIDDEN_KEY = "textus.agentTasksHidden";
/** Where the task list turns into a drawer (workspace.css). */
const NARROW = "(max-width: 1000px)";

export function AgentWorkspace({
  language,
  documentPath,
  draft,
  preview,
  conflict,
  conversation,
  children,
  onAccept,
  onReject,
  onImageAccept,
  onImageReject,
  rejected = NO_REJECTED,
  onRestore,
  onDecidePart,
  onUndoReject,
  isSettled = ALWAYS_SETTLED,
  tools,
  mediaPreview,
  pendingMedia = false,
  onStop,
  toolLabels = {},
  documentId,
  suggestions,
  aiSuggestions = false,
  autoWriter,
  pendingImages = NO_PENDING_IMAGES,
}: {
  language: string;
  documentPath: string | null;
  draft: DocumentDraft | null;
  preview: string;
  conflict: boolean;
  conversation: AgentConversation;
  children: ReactNode;
  onAccept: (callId?: string) => void;
  onReject: (callId?: string) => void;
  /** A finished picture shown in the draft: put in (with its paragraph)
   *  or dropped. */
  onImageAccept?: (jobId: string) => void;
  onImageReject?: (jobId: string) => void;
  /** This task's rejected changes, listed with 采纳 so one can be taken
   *  after all (onRestore). */
  rejected?: DraftOperation[];
  onRestore?: (callId: string, proposal: EditProposal) => void;
  /** One paragraph of a change taken or not: `part` is its index in an
   *  unsplit change (-1: `callId` is already that paragraph). */
  onDecidePart?: (callId: string, part: number, take: boolean) => void;
  /** A rejected paragraph back to undecided (恢复 in the preview). */
  onUndoReject?: (callId: string) => void;
  /** Whether a change has finished arriving: one still being written
   *  waits, the rest can be decided while the Agent keeps working. */
  isSettled?: (callId: string) => boolean;
  tools?: ReactNode;
  mediaPreview?: ReactNode;
  pendingMedia?: boolean;
  onStop?: () => void;
  /** Friendly names for tool calls (chat-labels' toolActivity). */
  toolLabels?: Record<string, string>;
  /** This document's identity, to tell its own past tasks from others'. */
  documentId?: string;
  /** The home's chips (assist.ts); the labels' static ones otherwise. */
  suggestions?: Suggestion[];
  /** Whether those were written by the model for this document. */
  aiSuggestions?: boolean;
  /** The auto-writing panel while it is open (AutoWriter.tsx). */
  autoWriter?: ReactNode;
  /** Pictures on their way, shown where they will go (draft-diff.ts). */
  pendingImages?: PendingImage[];
}) {
  const labels = workspaceLabels(language);
  // The document panel renders the markdown itself: its pictures' paths
  // (relative to the document's folder, or absolute for an unsaved one)
  // resolve as the editor's do, or the webview would load nothing. A
  // document picked in Files (iOS) reads them asynchronously instead.
  const shownDocument = preview || draft?.baseMarkdown || "";
  const scoped = !!documentPath && isScopedUrl(documentPath);
  const imageSrc = useCallback(
    (src: string) => resolveImageSrc(src, documentPath),
    [documentPath],
  );
  const documentView = useRef<HTMLDivElement>(null);
  // While a draft waits, the panel marks what it changes against the
  // document as it is (draft-diff.ts) - where a paragraph goes, which words
  // a rewrite changes - instead of showing the finished text alone.
  // At a lower priority than typing and animation: a streamed proposal
  // updates the draft several times a second, and each update renders the
  // whole document. The document as it is changes far less often.
  const katexReady = useKatexReady();
  const draftPreview = useDeferredValue(
    draft?.operations.length ? preview : "",
  );
  const baseMarkdown = draft?.baseMarkdown ?? "";
  const baseHtml = useMemo(
    () => renderDocumentHtml(baseMarkdown),
    // katexReady: formulas render once KaTeX is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseMarkdown, katexReady],
  );
  // One rendering for the document and the draft: the draft's changes
  // marked, pictures still being made shown where they will go.
  // Where each pending change sits in the marked document - the text of
  // the blocks it writes (a deletion: the passage it removes) - with its
  // paragraphs, and those of them already rejected.
  const pendingOps = draft?.operations;
  const changeTargets = useMemo(() => {
    const blockTexts = (markdown: string) => {
      const template = document.createElement("template");
      template.innerHTML = renderDocumentHtml(markdown);
      return [...template.content.children].map((el) => el.textContent ?? "");
    };
    const groups = new Map<string, ChangeTarget>();
    for (const { callId, proposal, parent } of pendingOps ?? []) {
      const id = parent ?? callId;
      const target = groups.get(id) ?? {
        callId: id,
        parts: [],
        splittable: INSERTS.has(proposal.action),
      };
      groups.set(id, target);
      const source =
        proposal.action === "delete"
          ? (proposal.anchor ?? "")
          : (proposal.text ?? "");
      if (parent) target.parts.push({ call: callId, part: -1, text: source });
      else
        blockTexts(source).forEach((text, part) =>
          target.parts.push({ call: callId, part, text }),
        );
    }
    for (const op of rejected) {
      const target = op.parent ? groups.get(op.parent) : undefined;
      if (!target || op.part === undefined || !op.parts) continue;
      // After the nearest earlier paragraph still on show.
      let after = "";
      for (let j = op.part - 1; j >= 0 && !after; j--) {
        const shown = target.parts.find((p) => p.call === `${op.parent}::${j}`);
        if (shown) after = blockTexts(shown.text)[0] ?? "";
      }
      (target.rejected ??= []).push({
        call: op.callId,
        part: op.part,
        html: renderDocumentHtml(op.proposal.text ?? ""),
        after,
      });
    }
    return [...groups.values()];
  }, [pendingOps, rejected]);
  const marked = useMemo(() => {
    const { html, changes } = draftPreview
      ? markDraftChanges(baseHtml, renderDocumentHtml(draftPreview))
      : { html: renderDocumentHtml(shownDocument), changes: 0 };
    return {
      changes,
      inner: {
        __html: withImageSrc(
          withChangeActions(
            withImagePlaceholders(
              html,
              pendingImages,
              labels.imagePending,
              labels.imageReady,
              onImageAccept
                ? {
                    accept: labels.take,
                    reject: labels.skip,
                    skipped: labels.imageSkipped,
                    approved: labels.imageApproved,
                  }
                : undefined,
            ),
            draftPreview ? changeTargets : [],
            {
              accept: labels.take,
              reject: labels.dontTake,
              acceptPart: labels.takePart,
              rejectPart: labels.dontTakePart,
              restore: labels.restore,
            },
          ),
          scoped ? undefined : imageSrc,
        ),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draftPreview,
    baseHtml,
    shownDocument,
    pendingImages,
    changeTargets,
    imageSrc,
    scoped,
    katexReady,
  ]);
  const [changeAt, setChangeAt] = useState(-1);
  /** Scrolls the panel to change `index` (wrapping) and flashes it. */
  const showChange = (index: number) => {
    const panel =
      documentView.current?.closest<HTMLElement>(".workspace-preview");
    const all = [
      ...(documentView.current?.querySelectorAll<HTMLElement>(
        ".draft-added, .draft-changed, .draft-removed",
      ) ?? []),
    ];
    if (!panel || !all.length) return;
    const at = ((index % all.length) + all.length) % all.length;
    const el = all[at];
    setChangeAt(at);
    panel.scrollTo({
      top:
        panel.scrollTop +
        el.getBoundingClientRect().top -
        panel.getBoundingClientRect().top -
        panel.clientHeight * 0.25,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
    el.classList.remove("draft-focus");
    // Restart the flash on a repeated jump to the same place.
    void el.offsetWidth;
    el.classList.add("draft-focus");
  };
  // A draft's first changes come into view on their own.
  const hadChanges = useRef(false);
  useEffect(() => {
    const has = !!marked?.changes;
    if (has && !hadChanges.current) requestAnimationFrame(() => showChange(0));
    if (!has) setChangeAt(-1);
    hadChanges.current = has;
  }, [marked]);
  useLayoutEffect(() => {
    if (!scoped) return;
    for (const img of documentView.current?.querySelectorAll("img") ?? []) {
      const src = img.getAttribute("src");
      if (src && !img.dataset.docSrc) showDocImage(img, src, documentPath);
    }
  }, [scoped, shownDocument, documentPath]);
  const history = useChatHistory();
  // Every past task, newest first: one from another document opens that
  // document too (OPEN_TASK_EVENT), so the conversation and its text return
  // together.
  const savedTasks = useMemo(
    () => history.filter((entry) => entry.id !== conversation.conversationId),
    [history, conversation.conversationId],
  );
  const ownTask = (entry: ChatHistoryEntry) =>
    entry.documentId
      ? entry.documentId === documentId
      : !!documentPath && entry.docPath === documentPath;
  const openTask = (entry: ChatHistoryEntry) => {
    if (ownTask(entry)) {
      guarded(() => conversation.restore(entry.id, entry.turns));
      return;
    }
    setTasksOpen(false);
    window.dispatchEvent(
      new CustomEvent<OpenTask>(OPEN_TASK_EVENT, {
        detail: {
          entryId: entry.id,
          docPath: entry.docPath,
          documentId: entry.documentId ?? null,
          snapshot: entry.snapshot ?? textFromProposals(entry) ?? null,
          title: entry.title,
        },
      }),
    );
  };
  // A past task's own menu (right-click) and its × on hover: deleting is
  // undoable for a few seconds - the history has no other way back.
  const [taskMenu, setTaskMenu] = useState<{
    entry: ChatHistoryEntry;
    x: number;
    y: number;
  } | null>(null);
  const [deleted, setDeleted] = useState<ChatHistoryEntry | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );
  const deleteTask = (entry: ChatHistoryEntry) => {
    deleteConversation(entry.id);
    setDeleted(entry);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setDeleted(null), 6000);
  };
  const undoDelete = () => {
    if (deleted) saveConversation(deleted);
    setDeleted(null);
  };
  const [notice, setNotice] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  // In a wide window the task list is a column that can be folded away
  // (remembered); narrow, it is a drawer (tasksOpen).
  const [tasksHidden, setTasksHidden] = useState(
    () => localStorage.getItem(TASKS_HIDDEN_KEY) === "1",
  );
  const toggleTasks = () => {
    if (window.matchMedia(NARROW).matches) {
      setTasksOpen((open) => !open);
      return;
    }
    setTasksHidden((hidden) => {
      localStorage.setItem(TASKS_HIDDEN_KEY, hidden ? "0" : "1");
      return !hidden;
    });
  };
  const root = useRef<HTMLElement>(null);
  const pending = draft?.operations ?? [];
  // Deciding does not wait for the Agent to finish talking - only for the
  // text itself to have arrived.
  const anySettled = pending.some((op) => isSettled(op.callId));
  const streamingTurns = conversation.streaming?.turns;
  // One pass over the turns: tasks, tool steps and each step's result.
  const { tasks, steps } = useMemo(() => {
    const turns = [...conversation.history, ...(streamingTurns ?? [])];
    const results = new Map<string, string>();
    for (const turn of turns)
      if (turn.kind === "ToolResult")
        results.set(
          turn.call_id,
          (results.has(turn.call_id) ? results.get(turn.call_id) + "\n" : "") +
            turn.output,
        );
    const tasks: string[] = [];
    // One row per run of plain tool steps ("Counting ×6 · Checking ×3",
    // tool-steps.ts), one per proposal or comment.
    const steps: {
      id: string;
      names: { name: string; count: number }[];
      detail: string;
      done: boolean;
    }[] = [];
    const { groups } = foldToolSteps(turns);
    // Auto-writing's sections are one task ("已写 3/4 节"), and only the
    // section in hand lists its steps.
    let autoTask = -1;
    turns.forEach((turn, i) => {
      if (turn.kind === "User") {
        const body = userMessageBody(turn.text);
        const auto = AUTO_SECTION_LINE.exec(body);
        if (auto) {
          const [k, n] = [auto[1] ?? auto[3], auto[2] ?? auto[4]];
          const line = auto[1]
            ? `自动写作 · 已写 ${k}/${n} 节`
            : `Auto-writing · section ${k}/${n}`;
          if (autoTask >= 0 && autoTask === tasks.length - 1)
            tasks[autoTask] = line;
          else {
            tasks.push(line);
            autoTask = tasks.length - 1;
          }
          steps.length = 0;
        } else {
          autoTask = -1;
          tasks.push(body.slice(0, 120));
        }
      }
      const run = groups.get(i);
      if (run && turn.kind === "ToolCall")
        steps.push({
          id: turn.call_id,
          names: toolStepCounts(run),
          detail: run.map((step) => step.output ?? step.arguments).join("\n\n"),
          done: run.every((step) => step.output !== null),
        });
      else if (turn.kind === "ToolCall" && !run && isCardTool(turn.name))
        steps.push({
          id: turn.call_id,
          names: [{ name: turn.name, count: 1 }],
          detail: results.get(turn.call_id) ?? turn.arguments,
          done: results.has(turn.call_id),
        });
    });
    return { tasks, steps };
  }, [conversation.history, streamingTurns]);
  const hasDraft = pending.length > 0 || pendingMedia;
  // The panel can be tucked away to read the conversation; a new change
  // brings it back.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (pending.length) setCollapsed(false);
  }, [pending.length]);
  const previewOpen = hasDraft && !collapsed;
  // The draft panel narrows the conversation column; instead of jumping to
  // its new place, the column glides there (a transform - nothing is laid
  // out again per frame).
  const conversationView = useRef<HTMLDivElement>(null);
  const columnLeft = useRef<number | null>(null);
  useLayoutEffect(() => {
    const column = conversationView.current;
    if (!column) return;
    const left = column.getBoundingClientRect().left;
    const before = columnLeft.current;
    columnLeft.current = left;
    if (
      before === null ||
      Math.abs(before - left) < 2 ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    column.animate(
      [{ transform: `translateX(${before - left}px)` }, { transform: "none" }],
      { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [previewOpen]);
  const status = conversation.busy
    ? "running"
    : pending.length
      ? "ready"
      : "idle";
  const guarded = (action: () => void) => {
    if (pending.length || pendingMedia) {
      setNotice(true);
      return;
    }
    action();
    setNotice(false);
    setTasksOpen(false);
  };
  const stepName = (name: string) =>
    name === "propose_edit"
      ? labels.proposal
      : (toolLabels[name] ?? toolLabels["*"] ?? name);
  return (
    <section
      ref={root}
      className={`agent-workspace agent-home ${tasks.length || autoWriter ? "has-conversation" : "is-empty"}${autoWriter ? " is-auto-writing" : ""}${previewOpen ? " has-draft-open" : ""}${tasksOpen ? " tasks-open" : ""}${tasksHidden ? " tasks-hidden" : ""}`}
      aria-label={labels.title}
    >
      <header className="workspace-header">
        <button
          className="workspace-icon-button workspace-tasks-toggle"
          aria-label={labels.tasks}
          aria-expanded={tasksOpen || !tasksHidden}
          title={labels.tasks}
          onClick={toggleTasks}
        >
          <HamburgerIcon />
        </button>
        <span className={`workspace-status is-${status}`} role="status">
          <span className="workspace-status-dot" aria-hidden />
          {labels[status]}
        </span>
        <span className="workspace-header-spacer" />
        {/* A blank document in a new tab of this window; the window stays in
            Agent, so the next task starts on the new document. */}
        <button
          className="workspace-button workspace-new-document"
          onClick={() => window.dispatchEvent(new Event(NEW_DOCUMENT_EVENT))}
        >
          <PlusIcon />
          {labels.newDocument}
        </button>
        {/* The composer's own Stop covers a running reply; this one is for
            images still generating after the reply ended. */}
        {pendingMedia && !conversation.busy && (
          <button
            className="workspace-button is-danger"
            onClick={onStop ?? conversation.stop}
          >
            {labels.stop}
          </button>
        )}
        {/* Write → is in the window bar, mirroring Write's "← Agent". */}
      </header>
      <div className="workspace-columns">
        <div
          className="workspace-tasks-scrim"
          aria-hidden
          onClick={() => setTasksOpen(false)}
        />
        <aside className="workspace-tasks">
          <button
            className="workspace-new-task"
            disabled={conversation.busy}
            onClick={() => guarded(conversation.reset)}
          >
            <PlusIcon />
            {labels.newTask}
          </button>
          {notice && (
            <p className="workspace-notice" role="alert">
              {labels.resolve}
            </p>
          )}
          {tasks.length > 0 && (
            <>
              <h3>{labels.conversation}</h3>
              {tasks.map((task, i) => (
                <p className="workspace-task-line" key={i}>
                  {task}
                </p>
              ))}
            </>
          )}
          {steps.length > 0 && (
            <ol className="workspace-timeline">
              {steps.map((step) => (
                <li
                  key={step.id}
                  className={step.done ? "is-done" : "is-running"}
                >
                  <details>
                    <summary>
                      <span className="workspace-step-mark" aria-hidden>
                        {step.done ? <CheckIcon /> : null}
                      </span>
                      {step.names.map(({ name, count }, i) => (
                        <span key={name}>
                          {i > 0 && " · "}
                          {stepName(name)}
                          {count > 1 && (
                            <span className="workspace-step-count">
                              ×{count}
                            </span>
                          )}
                        </span>
                      ))}
                    </summary>
                    <pre>{step.detail}</pre>
                  </details>
                </li>
              ))}
            </ol>
          )}
          <h3>{labels.history}</h3>
          {savedTasks.length === 0 && (
            <div className="workspace-empty-history">{labels.noHistory}</div>
          )}
          {deleted && (
            <div className="workspace-history-undo" role="status">
              <span>{labels.taskDeleted}</span>
              <button type="button" onClick={undoDelete}>
                {labels.undo}
              </button>
            </div>
          )}
          {savedTasks.map((entry) => (
            <div className="workspace-history-row" key={entry.id}>
              <button
                className="workspace-history-task"
                disabled={conversation.busy}
                title={entry.title}
                onClick={() => openTask(entry)}
                onContextMenu={(event) => {
                  // Its own menu - not the editor's, which the Agent
                  // surface would otherwise reach through its portal.
                  event.preventDefault();
                  event.stopPropagation();
                  setTaskMenu({ entry, x: event.clientX, y: event.clientY });
                }}
              >
                <span className="workspace-history-title">{entry.title}</span>
                {!ownTask(entry) && (entry.docPath || entry.snapshot) && (
                  <span className="workspace-history-doc">
                    {entry.docPath
                      ? basename(entry.docPath)
                      : (firstLevelOneHeading(entry.snapshot ?? "") ??
                        labels.untitledDoc)}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="workspace-history-delete"
                aria-label={labels.deleteTask}
                title={labels.deleteTask}
                onClick={() => deleteTask(entry)}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
          {/* On the page itself: the task list scrolls, and the surface
              it sits in moves while Agent opens. */}
          {createPortal(
            <Presence show={!!taskMenu} exitMs={150}>
              {taskMenu && (
                <ContextMenu
                  x={taskMenu.x}
                  y={taskMenu.y}
                  title={taskMenu.entry.title}
                  onClose={() => setTaskMenu(null)}
                  items={[
                    {
                      label: labels.openTask,
                      onSelect: () => openTask(taskMenu.entry),
                    },
                    "separator",
                    {
                      label: labels.deleteTask,
                      danger: true,
                      onSelect: () => deleteTask(taskMenu.entry),
                    },
                  ]}
                />
              )}
            </Presence>,
            document.body,
          )}
        </aside>
        <div className="workspace-conversation" ref={conversationView}>
          {autoWriter}
          {!tasks.length && !autoWriter && (
            <div className="agent-home-heading">
              <span className="agent-home-mark" aria-hidden>
                ✳
              </span>
              <h1>{labels.heading}</h1>
              <p>{labels.subheading}</p>
            </div>
          )}
          {children}
          {hasDraft && collapsed && (
            <button
              className="workspace-draft-pill"
              onClick={() => setCollapsed(false)}
            >
              {labels.preview}
              {pending.length > 0 && (
                <span className="workspace-count">{pending.length}</span>
              )}
            </button>
          )}
          {!tasks.length && !autoWriter && (
            <div
              className={`agent-home-suggestions${aiSuggestions ? " is-ai" : ""}`}
              // Re-mounted when the model's set replaces the fallbacks, so
              // the chips arrive again instead of changing in place.
              key={aiSuggestions ? "ai" : "static"}
            >
              {(
                suggestions ??
                labels.suggestions.map((prompt) => ({ label: prompt, prompt }))
              ).map((suggestion, i) => (
                <button
                  key={suggestion.label}
                  style={{ "--i": i } as React.CSSProperties}
                  title={suggestion.prompt}
                  onClick={() => fillComposer(root.current, suggestion.prompt)}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          )}
          {tools && <div className="workspace-extra-tools">{tools}</div>}
        </div>
        <div
          className={`workspace-preview ${previewOpen ? "has-draft" : "document-card"}`}
          aria-hidden={!previewOpen}
          inert={!previewOpen}
        >
          <header>
            <strong>{pending.length ? labels.preview : labels.current}</strong>
            {pending.length > 0 && (
              <span className="workspace-count" key={pending.length}>
                {pending.length}
              </span>
            )}
            <span className="workspace-header-spacer" />
            <button
              className="workspace-icon-button workspace-collapse"
              aria-label={labels.collapse}
              title={labels.collapse}
              onClick={() => setCollapsed(true)}
            >
              <ChevronIcon />
            </button>
          </header>
          <p className="workspace-hint">{labels.saved}</p>
          {conflict && (
            <p className="workspace-conflict" role="alert">
              {labels.conflict}
            </p>
          )}
          {marked && marked.changes > 0 && (
            <div className="workspace-change-nav" role="group">
              <span>{labels.changeCount(marked.changes)}</span>
              <button
                type="button"
                className="workspace-icon-button"
                aria-label={labels.previousChange}
                title={labels.previousChange}
                onClick={() => showChange(changeAt - 1)}
              >
                <ChevronIcon className="is-up" />
              </button>
              <button
                type="button"
                className="workspace-icon-button"
                aria-label={labels.nextChange}
                title={labels.nextChange}
                onClick={() => showChange(changeAt + 1)}
              >
                <ChevronIcon className="is-down" />
              </button>
            </div>
          )}
          <div
            className="workspace-document"
            ref={documentView}
            onClick={(event) => {
              // Each change's own 采纳 / 不采纳 (draft-diff.ts): markup too.
              const change = (event.target as HTMLElement).closest<HTMLElement>(
                "[data-change-action]",
              );
              const call = change?.dataset.call;
              if (call) {
                if (change.dataset.changeAction === "reject") onReject(call);
                else if (!conflict) onAccept(call);
                return;
              }
              // One paragraph of a change, and a rejected one's 恢复.
              const part = (event.target as HTMLElement).closest<HTMLElement>(
                "[data-part-action]",
              );
              if (part?.dataset.call) {
                const take = part.dataset.partAction === "accept";
                if (!take || !conflict)
                  onDecidePart?.(
                    part.dataset.call,
                    Number(part.dataset.part ?? -1),
                    take,
                  );
                return;
              }
              const back = (event.target as HTMLElement).closest<HTMLElement>(
                "[data-restore]",
              );
              if (back?.dataset.restore) {
                onUndoReject?.(back.dataset.restore);
                return;
              }
              // The ready pictures' buttons (draft-diff.ts): markup, not React.
              const button = (event.target as HTMLElement).closest<HTMLElement>(
                "[data-image-action]",
              );
              const job = button?.dataset.job;
              if (!job) return;
              if (button.dataset.imageAction === "accept") {
                if (!conflict) onImageAccept?.(job);
              } else onImageReject?.(job);
            }}
          >
            <div
              className={`agent-markdown${draftPreview ? " draft-document" : ""}`}
              dangerouslySetInnerHTML={marked.inner}
            />
          </div>
          {mediaPreview}
          {(pending.length > 0 || rejected.length > 0) && (
            <>
              <details className="workspace-changes">
                <summary>
                  {labels.changes} ({pending.length})
                  {rejected.length > 0 && (
                    <span className="workspace-changes-skipped">
                      {" · "}
                      {labels.skippedCount(rejected.length)}
                    </span>
                  )}
                </summary>
                {pending.map(({ callId, proposal }) => (
                  <article key={callId}>
                    <strong>
                      {proposal.reason ||
                        proposal.text?.split("\n")[0] ||
                        proposal.action}
                    </strong>
                    {proposal.anchor && (
                      <blockquote>{proposal.anchor}</blockquote>
                    )}
                    <pre>{proposal.text}</pre>
                    <div className="workspace-change-actions">
                      <button
                        className="workspace-button"
                        disabled={conflict || !isSettled(callId)}
                        onClick={() => onAccept(callId)}
                      >
                        {labels.take}
                      </button>
                      <button
                        className="workspace-button is-quiet"
                        disabled={!isSettled(callId)}
                        onClick={() => onReject(callId)}
                      >
                        {labels.skip}
                      </button>
                    </div>
                  </article>
                ))}
                {/* Skipped, not gone ("万一后悔"): folded, with 采纳. */}
                {rejected.map(({ callId, proposal }) => (
                  <article key={callId} className="is-skipped">
                    <strong>
                      {proposal.reason ||
                        proposal.text?.split("\n")[0] ||
                        proposal.action}
                    </strong>
                    <div className="workspace-change-actions">
                      <span className="workspace-change-state">
                        {labels.skipped}
                      </span>
                      {onRestore && (
                        <button
                          className="workspace-button"
                          onClick={() => onRestore(callId, proposal)}
                        >
                          {labels.take}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </details>
              {pending.length > 0 && (
                <div className="workspace-review-actions">
                  <button
                    className="workspace-button is-primary"
                    aria-label={labels.accept}
                    disabled={conflict || !anySettled}
                    onClick={() => onAccept()}
                  >
                    {labels.accept}
                    {changeTargets.length > 1 && (
                      <span className="workspace-review-count" aria-hidden>
                        {changeTargets.length}
                      </span>
                    )}
                  </button>
                  <button
                    className="workspace-button"
                    aria-label={labels.reject}
                    disabled={!anySettled}
                    onClick={() => onReject()}
                  >
                    {labels.reject}
                    {changeTargets.length > 1 && (
                      <span className="workspace-review-count" aria-hidden>
                        {changeTargets.length}
                      </span>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
