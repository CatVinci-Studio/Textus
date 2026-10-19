import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DocumentDraft } from "./document-draft";
import type { AgentConversation } from "../chat/useAgentConversation";
import { MarkdownText } from "../MarkdownText";
import { workspaceLabels } from "./labels";
import { userMessageBody } from "../chat/user-message";
import { useChatHistory } from "../chat/chat-history";
import {
  CheckIcon,
  ChevronIcon,
  HamburgerIcon,
  PlusIcon,
} from "../../ui/icons";
import type { Suggestion } from "./assist";
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
  suggestions,
  aiSuggestions = false,
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
  /** The home's chips (assist.ts); the labels' static ones otherwise. */
  suggestions?: Suggestion[];
  /** Whether those were written by the model for this document. */
  aiSuggestions?: boolean;
}) {
  const labels = workspaceLabels(language);
  const history = useChatHistory();
  const savedTasks = useMemo(
    () =>
      history.filter(
        (entry) =>
          entry.docPath === documentPath &&
          entry.id !== conversation.conversationId,
      ),
    [history, documentPath, conversation.conversationId],
  );
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
    const steps: {
      id: string;
      name: string;
      detail: string;
      done: boolean;
    }[] = [];
    for (const turn of turns) {
      if (turn.kind === "User")
        tasks.push(userMessageBody(turn.text).slice(0, 120));
      else if (turn.kind === "ToolCall")
        steps.push({
          id: turn.call_id,
          name: turn.name,
          detail: results.get(turn.call_id) ?? turn.arguments,
          done: results.has(turn.call_id),
        });
    }
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
      className={`agent-workspace agent-home ${tasks.length ? "has-conversation" : "is-empty"}${previewOpen ? " has-draft-open" : ""}${tasksOpen ? " tasks-open" : ""}`}
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
                      {stepName(step.name)}
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
              onClick={() =>
                guarded(() => conversation.restore(entry.id, entry.turns))
              }
            >
              {entry.title}
            </button>
          ))}
        </aside>
        <div className="workspace-conversation">
          {!tasks.length && (
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
          {!tasks.length && (
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
          <div className="workspace-document">
            <MarkdownText text={preview || draft?.baseMarkdown || ""} />
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
