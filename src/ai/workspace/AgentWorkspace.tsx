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
import type { DocumentDraft } from "./document-draft";
import type { AgentConversation } from "../chat/useAgentConversation";
import { withImageSrc } from "../MarkdownText";
import { renderDocumentHtml } from "../../editor/markdown/render-html";
import { useKatexReady } from "../../editor/math/katex-loader";
import {
  markDraftChanges,
  withImagePlaceholders,
  type PendingImage,
} from "./draft-diff";
import { workspaceLabels } from "./labels";
import { userMessageBody } from "../chat/user-message";
import { foldToolSteps, isCardTool, toolStepCounts } from "../chat/tool-steps";
import { useChatHistory, type ChatHistoryEntry } from "../chat/chat-history";
import { parseProposal } from "../chat/proposal";
import { basename } from "../../utils/path";
import { firstLevelOneHeading } from "../../document/save-default-name";
import {
  CheckIcon,
  ChevronIcon,
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
  const marked = useMemo(() => {
    const { html, changes } = draftPreview
      ? markDraftChanges(baseHtml, renderDocumentHtml(draftPreview))
      : { html: renderDocumentHtml(shownDocument), changes: 0 };
    return {
      changes,
      inner: {
        __html: withImageSrc(
          withImagePlaceholders(html, pendingImages, labels.imagePending),
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
  const [notice, setNotice] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const pending = draft?.operations ?? [];
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
    turns.forEach((turn, i) => {
      if (turn.kind === "User")
        tasks.push(userMessageBody(turn.text).slice(0, 120));
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
      className={`agent-workspace agent-home ${tasks.length || autoWriter ? "has-conversation" : "is-empty"}${autoWriter ? " is-auto-writing" : ""}${previewOpen ? " has-draft-open" : ""}${tasksOpen ? " tasks-open" : ""}`}
      aria-label={labels.title}
    >
      <header className="workspace-header">
        <button
          className="workspace-icon-button workspace-tasks-toggle"
          aria-label={labels.tasks}
          aria-expanded={tasksOpen}
          onClick={() => setTasksOpen((open) => !open)}
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
          {savedTasks.map((entry) => (
            <button
              className="workspace-history-task"
              key={entry.id}
              disabled={conversation.busy}
              title={entry.title}
              onClick={() => openTask(entry)}
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
          ))}
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
          <div className="workspace-document" ref={documentView}>
            <div
              className={`agent-markdown${draftPreview ? " draft-document" : ""}`}
              dangerouslySetInnerHTML={marked.inner}
            />
          </div>
          {mediaPreview}
          {pending.length > 0 && (
            <>
              <details className="workspace-changes">
                <summary>
                  {labels.changes} ({pending.length})
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
                        disabled={conversation.busy || conflict}
                        onClick={() => onAccept(callId)}
                      >
                        {labels.take}
                      </button>
                      <button
                        className="workspace-button is-quiet"
                        disabled={conversation.busy}
                        onClick={() => onReject(callId)}
                      >
                        {labels.skip}
                      </button>
                    </div>
                  </article>
                ))}
              </details>
              <div className="workspace-review-actions">
                <button
                  className="workspace-button is-primary"
                  disabled={conversation.busy || conflict}
                  onClick={() => onAccept()}
                >
                  {labels.accept}
                </button>
                <button
                  className="workspace-button"
                  disabled={conversation.busy}
                  onClick={() => onReject()}
                >
                  {labels.reject}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
