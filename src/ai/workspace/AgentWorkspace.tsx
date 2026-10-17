import { useState, type ReactNode } from "react";
import type { DocumentDraft } from "./document-draft";
import type { AgentConversation } from "../chat/useAgentConversation";
import { MarkdownText } from "../MarkdownText";
import { workspaceLabels } from "./labels";
import { userMessageBody } from "../chat/user-message";
import "./workspace.css";

export function AgentWorkspace({
  language,
  title,
  draft,
  preview,
  conflict,
  conversation,
  children,
  onEditor,
  onAccept,
  onReject,
}: {
  language: string;
  title: string;
  draft: DocumentDraft | null;
  preview: string;
  conflict: boolean;
  conversation: AgentConversation;
  children: ReactNode;
  onEditor: () => void;
  onAccept: (callId?: string) => void;
  onReject: (callId?: string) => void;
}) {
  const labels = workspaceLabels(language);
  const [notice, setNotice] = useState(false);
  const pending = draft?.operations ?? [];
  const turns = [
    ...conversation.history,
    ...(conversation.streaming?.turns ?? []),
  ];
  const tasks = turns.filter((t) => t.kind === "User");
  const steps = turns.filter((t) => t.kind === "ToolCall");
  return (
    <section className="agent-workspace" aria-label={labels.title}>
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
        {conversation.busy && (
          <button onClick={conversation.stop}>{labels.stop}</button>
        )}
        <button onClick={onEditor}>{labels.editor}</button>
      </header>
      <div className="workspace-columns">
        <aside className="workspace-tasks">
          <button
            disabled={conversation.busy}
            onClick={() => {
              if (pending.length) {
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
          <h3>{labels.task}</h3>
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
                {turn.kind === "ToolCall"
                  ? turn.name === "propose_edit"
                    ? labels.changes
                    : turn.name
                  : ""}
              </li>
            ))}
          </ol>
        </aside>
        <div className="workspace-conversation">
          {!tasks.length && <p className="workspace-intro">{labels.empty}</p>}
          {children}
        </div>
        <div className="workspace-preview">
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
