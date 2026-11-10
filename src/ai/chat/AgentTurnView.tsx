import { pictureSrc } from "../revision/generated-images";
import { lazy, Suspense, useState } from "react";
import type { AgentTurn, ImageAttachment, WebSource } from "../types";
import { links } from "../../platform/ipc";
import { MarkdownText } from "../MarkdownText";
import { parseUserMessage } from "./user-message";
import { ReplyThemes, type ReplyThemeLabels } from "./ReplyThemes";
import type { ReplyPluginLabels } from "./ReplyPlugins";
import { ReplySkills } from "./ReplySkills";
import {
  ChevronIcon,
  PaperclipIcon,
  SearchIcon,
} from "../../engine/controls/icons";
import "./AgentTurnView.css";
import { toolActivityText } from "./tool-activity";
import { siteOf } from "../citations";
import {
  ContextMenu,
  type ContextMenuItem,
} from "../../engine/controls/ContextMenu";
import { Presence } from "../../engine/motion/usePresence";
import { INSERT_MARKDOWN_EVENT } from "../../utils/events";

/** The main window, whose document a reply can go into. */
const inEditorWindow = () =>
  new URLSearchParams(window.location.search).get("view") !== "chat";

const copyItem = (label: string, text: string): ContextMenuItem => ({
  label,
  onSelect: () => void navigator.clipboard.writeText(text).catch(() => {}),
});

/** A message's right-click menu: where it opened and what it offers. */
function useMessageMenu() {
  const [at, setAt] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  return {
    /** `items` for the whole message; with words of it selected, Copy
     *  (the first item's label) copies those instead. */
    open: (e: React.MouseEvent, items: ContextMenuItem[]) => {
      e.preventDefault();
      const selected = getSelection()?.toString() ?? "";
      setAt({
        x: e.clientX,
        y: e.clientY,
        items: selected ? [copyItem(items[0].label, selected)] : items,
      });
    },
    element: (
      <Presence show={at !== null} exitMs={120}>
        {at && (
          <ContextMenu
            x={at.x}
            y={at.y}
            items={at.items}
            onClose={() => setAt(null)}
          />
        )}
      </Presence>
    ),
  };
}

// A reply that wrote a plugin brings in the plugin manager: loaded only then.
const ReplyPlugins = lazy(() =>
  import("./ReplyPlugins").then((m) => ({ default: m.ReplyPlugins })),
);

export interface AgentTurnLabels extends ReplyThemeLabels, ReplyPluginLabels {
  /** Selection chip, for a selection of `n` characters. */
  selectionChip: (n: number) => string;
  /** The chip of a selection that was one picture. */
  selectedPicture: string;
  /** What each tool call is doing, by tool name; "{arg}" is its main
   *  argument (query, heading, path, skill); "*" covers any other tool. */
  toolActivity: Record<string, string>;
  toolResult: string;
  /** The heading of the list of web pages under a reply. */
  sources: string;
  /** A message's right-click menu. */
  messageCopy: string;
  messageCopyMarkdown: string;
  messageInsert: string;
}

export function AgentTurnView({
  turn,
  labels,
  live = false,
}: {
  turn: AgentTurn;
  labels: AgentTurnLabels;
  /** An assistant reply still streaming in. */
  live?: boolean;
}) {
  const menu = useMessageMenu();
  switch (turn.kind) {
    case "User":
      return (
        <UserMessage
          text={turn.text}
          images={turn.images ?? []}
          labels={labels}
        />
      );
    case "Assistant":
      return (
        <div
          className="agent-message agent-message-assistant"
          onContextMenu={(e) =>
            menu.open(e, [
              copyItem(labels.messageCopy, e.currentTarget.innerText),
              copyItem(labels.messageCopyMarkdown, turn.text),
              // Into the document in front; the detached window has none.
              ...(inEditorWindow()
                ? [
                    {
                      label: labels.messageInsert,
                      onSelect: () =>
                        window.dispatchEvent(
                          new CustomEvent(INSERT_MARKDOWN_EVENT, {
                            detail: turn.text,
                          }),
                        ),
                    },
                  ]
                : []),
            ])
          }
        >
          <MarkdownText text={turn.text} live={live} />
          {turn.sources && turn.sources.length > 0 && (
            <SourceList sources={turn.sources} label={labels.sources} />
          )}
          <ReplyThemes text={turn.text} labels={labels} />
          {/\nname:/.test(turn.text) && <ReplySkills text={turn.text} />}
          {turn.text.includes("textus-plugin.json") && (
            <Suspense fallback={null}>
              <ReplyPlugins text={turn.text} labels={labels} />
            </Suspense>
          )}
          {menu.element}
        </div>
      );
    case "ToolCall":
      return (
        <div className="agent-tool-line">
          <SearchIcon className="agent-tool-icon" />
          {toolActivityText(turn.name, turn.arguments, labels)}
        </div>
      );
    case "ToolResult":
      return (
        <details className="disclosure agent-tool-result">
          <summary>{labels.toolResult}</summary>
          <pre>{turn.output}</pre>
        </details>
      );
    default:
      return null;
  }
}

/**
 * The user's own turn: their prose, with the selection and attachments that
 * rode along shown as chips. The selection chip expands to be checked.
 */
function UserMessage({
  text,
  images,
  labels,
}: {
  text: string;
  images: ImageAttachment[];
  labels: AgentTurnLabels;
}) {
  const { body, selection, attachments } = parseUserMessage(text);
  const [expanded, setExpanded] = useState(false);
  // Text attachments come from the <attached-file> blocks in the prompt;
  // images travel as provider image parts, so they come off the turn.
  const attachmentNames = [
    ...attachments,
    ...images.map((image) => image.name),
  ];

  const menu = useMessageMenu();
  return (
    <div
      className="agent-message agent-message-user"
      onContextMenu={(e) =>
        menu.open(e, [copyItem(labels.messageCopy, body ?? "")])
      }
    >
      {menu.element}
      {(selection !== null || attachmentNames.length > 0) && (
        <div className="agent-message-context">
          {selection !== null && (
            <button
              type="button"
              className="agent-context-chip"
              aria-expanded={expanded}
              onClick={() => setExpanded((prev) => !prev)}
            >
              <ChevronIcon
                className={`agent-context-chip-caret ${
                  expanded ? "agent-context-chip-caret-open" : ""
                }`}
              />
              {pictureSrc(selection) !== null
                ? labels.selectedPicture
                : labels.selectionChip([...selection].length)}
            </button>
          )}
          {attachmentNames.map((name, i) => (
            <span className="agent-context-chip" key={`${name}-${i}`}>
              <PaperclipIcon />
              {name}
            </span>
          ))}
        </div>
      )}
      {selection !== null && expanded && (
        <pre className="agent-message-selection">{selection}</pre>
      )}
      {body && <div className="agent-message-body">{body}</div>}
    </div>
  );
}

/**
 * The web pages a reply cites, by the numbers its text gives them: one chip
 * each that opens the page in the system browser.
 */
function SourceList({
  sources,
  label,
}: {
  sources: WebSource[];
  label: string;
}) {
  return (
    <div className="agent-sources" role="group" aria-label={label}>
      <span className="agent-sources-label">{label}</span>
      {sources.map((source) => {
        const site = siteOf(source.url);
        return (
          <button
            key={source.n}
            type="button"
            className="agent-source"
            title={source.url}
            onClick={() => void links.openWebLink(source.url).catch(() => {})}
          >
            <span className="agent-source-num">{source.n}</span>
            <span className="agent-source-site">{site}</span>
            {source.title && source.title !== site && (
              <span className="agent-source-title">{source.title}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
