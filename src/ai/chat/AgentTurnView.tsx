import { pictureSrc } from "../revision/generated-images";
import { lazy, Suspense, useState } from "react";
import type { AgentTurn, ImageAttachment, WebSource } from "../types";
import { links } from "../../platform/ipc";
import { MarkdownText } from "../MarkdownText";
import { siteOf } from "../citations";
import { parseUserMessage } from "./user-message";
import { ReplyThemes, type ReplyThemeLabels } from "./ReplyThemes";
import type { ReplyPluginLabels } from "./ReplyPlugins";
import { ReplySkills } from "./ReplySkills";
import { ChevronIcon, PaperclipIcon, SearchIcon } from "../../ui/icons";
import "./AgentTurnView.css";

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
}

/** A tool call as one readable line: "Reading the section “Methods”"
 *  rather than `read_document`. */
export function toolActivityText(
  name: string,
  argumentsJson: string,
  labels: AgentTurnLabels,
): string {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argumentsJson) ?? {};
  } catch {
    // Partial or malformed arguments: describe the tool without them.
  }
  // web_search takes a list of queries, web_fetch an address - shown by
  // its site, which is what says where the request went.
  const queries = Array.isArray(args.queries)
    ? args.queries
        .filter((q): q is string => typeof q === "string")
        .join("”, “")
    : undefined;
  const site = typeof args.url === "string" ? siteOf(args.url) : undefined;
  // An MCP server's tool, named as the model knows it (mcp_<server>_<tool>),
  // which says whose tool it is.
  if (name.startsWith("mcp_") && labels.toolActivity.mcp)
    return labels.toolActivity.mcp.replace("{arg}", name.slice(4));
  const arg =
    [args.query, queries, site, args.heading, args.path, args.name].find(
      (v): v is string => typeof v === "string" && v.length > 0,
    ) ??
    (typeof args.start_line === "number"
      ? `${args.start_line}–${typeof args.end_line === "number" ? args.end_line : ""}`
      : "");
  // A tool called with no argument may have its own wording ("Reading the
  // document" rather than "Reading “”"), keyed "<name>:whole".
  const template =
    (arg ? undefined : labels.toolActivity[`${name}:whole`]) ??
    labels.toolActivity[name] ??
    labels.toolActivity["*"];
  if (!template) return name;
  return template.replace("{arg}", arg);
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
        <div className="agent-message agent-message-assistant">
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
        <details className="agent-tool-result">
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

  return (
    <div className="agent-message agent-message-user">
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
