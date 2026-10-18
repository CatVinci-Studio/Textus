import { useState, type ReactNode } from "react";
import type { DocumentDraft } from "./document-draft";
import type { AgentConversation } from "../chat/useAgentConversation";
import { MarkdownText } from "../MarkdownText";
import { workspaceLabels } from "./labels";
import { userMessageBody } from "../chat/user-message";
import { useChatHistory } from "../chat/chat-history";
import "./workspace.css";

export function AgentWorkspace({
  language,
  title,
  documentPath,
  draft,
  preview,
  conflict,
  conversation,
  children,
  onEditor,
  onAccept,
  onReject,
  tools,
  mediaPreview,
  pendingMedia = false,
  onStop,
}: {
  language: string;
  title: string;
  documentPath: string | null;
  draft: DocumentDraft | null;
  preview: string;
  conflict: boolean;
  conversation: AgentConversation;
  children: ReactNode;
  onEditor: () => void;
  onAccept: (callId?: string) => void;
  onReject: (callId?: string) => void;
  tools?: ReactNode;
  mediaPreview?: ReactNode;
  pendingMedia?: boolean;
  onStop?: () => void;
}) {
  const labels = workspaceLabels(language);
  const savedTasks = useChatHistory().filter(
    (entry) =>
      entry.docPath === documentPath &&
      entry.id !== conversation.conversationId,
  );
  const [notice, setNotice] = useState(false);
  const pending = draft?.operations ?? [];
  const turns = [
    ...conversation.history,
    ...(conversation.streaming?.turns ?? []),
  ];
  const tasks = turns.filter((t) => t.kind === "User");
  const steps = turns.filter((t) => t.kind === "ToolCall");
  return (
    <section
      className={`agent-workspace agent-home ${tasks.length ? "has-conversation" : "is-empty"}`}
      aria-label={labels.title}
    >
      <header className="workspace-header">
        <div>
          <strong>{title}</strong>
          <span>{labels.title}</span>
        </div>
        <span role="status">
          {conversation.busy
            ? labels.running
            : pending.length
              ? labels.ready
              : labels.idle}
        </span>
        {(conversation.busy || pendingMedia) && (
          <button onClick={onStop ?? conversation.stop}>{labels.stop}</button>
        )}
        <button onClick={onEditor}>Write · {title}</button>
      </header>
      <div className="workspace-columns">
        <aside className="workspace-tasks">
          <button
            disabled={conversation.busy}
            onClick={() => {
              if (pending.length || pendingMedia) {
                setNotice(true);
                return;
              }
              conversation.reset();
              setNotice(false);
            }}
          >
            {labels.newTask}
          </button>
          {notice && <p role="alert">{labels.resolve}</p>}
          <h3>{language.startsWith("zh") ? "当前对话" : "Conversation"}</h3>
          {tasks.map((turn, i) => (
            <p key={i}>
              {turn.kind === "User"
                ? userMessageBody(turn.text).slice(0, 120)
                : ""}
            </p>
          ))}
          <ol className="workspace-timeline">
            {steps.map((turn, i) => (
              <li key={i}>
                <details>
                  <summary>
                    {turn.kind === "ToolCall"
                      ? turn.name === "propose_edit"
                        ? labels.changes
                        : turn.name
                      : ""}{" "}
                    {turn.kind === "ToolCall" &&
                    turns.some(
                      (result) =>
                        result.kind === "ToolResult" &&
                        result.call_id === turn.call_id,
                    )
                      ? "✓"
                      : "…"}
                  </summary>
                  {turn.kind === "ToolCall" && (
                    <pre>
                      {turns.find(
                        (result) =>
                          result.kind === "ToolResult" &&
                          result.call_id === turn.call_id,
                      )?.kind === "ToolResult"
                        ? turns
                            .filter(
                              (result) =>
                                result.kind === "ToolResult" &&
                                result.call_id === turn.call_id,
                            )
                            .map((result) =>
                              result.kind === "ToolResult" ? result.output : "",
                            )
                            .join("\n")
                        : turn.arguments}
                    </pre>
                  )}
                </details>
              </li>
            ))}
          </ol>
          <h3>{language.startsWith("zh") ? "历史任务" : "Task history"}</h3>
          {savedTasks.map((entry) => (
            <button
              className="workspace-history-task"
              key={entry.id}
              disabled={conversation.busy}
              onClick={() => {
                if (pending.length || pendingMedia) {
                  setNotice(true);
                  return;
                }
                conversation.restore(entry.id, entry.turns);
                setNotice(false);
              }}
            >
              {entry.title}
            </button>
          ))}
        </aside>
        <div className="workspace-conversation">
          {!tasks.length && (
            <div className="agent-home-heading">
              <span>✳</span>
              <h1>
                {language.startsWith("zh")
                  ? "与 Textus 一起创作"
                  : "Create with Textus"}
              </h1>
              <p>
                {language.startsWith("zh")
                  ? "从一个想法开始，写成你的作品。"
                  : "Start with an idea. Make it yours."}
              </p>
            </div>
          )}
          {children}
          {tools && <div className="workspace-extra-tools">{tools}</div>}
        </div>
        <div
          className={`workspace-preview ${pending.length || pendingMedia ? "has-draft" : "document-card"}`}
        >
          <header>
            <strong>{pending.length ? labels.preview : labels.current}</strong>
            <span>{pending.length}</span>
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
              <div className="workspace-review-actions">
                <button
                  disabled={conversation.busy || conflict}
                  onClick={() => onAccept()}
                >
                  {labels.accept}
                </button>
                <button disabled={conversation.busy} onClick={() => onReject()}>
                  {labels.reject}
                </button>
              </div>
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
                    <button
                      disabled={conversation.busy || conflict}
                      onClick={() => onAccept(callId)}
                    >
                      {labels.take}
                    </button>
                    <button
                      disabled={conversation.busy}
                      onClick={() => onReject(callId)}
                    >
                      {labels.skip}
                    </button>
                  </article>
                ))}
              </details>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
