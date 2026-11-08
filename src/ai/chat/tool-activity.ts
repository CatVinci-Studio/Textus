import type { Strings } from "../../i18n/strings";
import { siteOf } from "../citations";

/** What each tool call is doing, by tool name, for the chat and Research's
 *  card alike; "{arg}" is its main argument (query, heading, path, skill),
 *  "*" any other tool. */
export function toolActivityLabels(t: Strings): Record<string, string> {
  return {
    search_document: t.toolSearchDocument,
    read_document: t.toolReadDocument,
    // No heading named: the whole document, not an empty quote.
    "read_document:whole": t.toolReadWholeDocument,
    search_files: t.toolSearchFiles,
    search_references: t.toolSearchReferences,
    find_files: t.toolFindFiles,
    // No name: every file (and old chats' list_files).
    "find_files:whole": t.toolListFiles,
    list_files: t.toolListFiles,
    read_file: t.toolReadFile,
    use_skill: t.toolUseSkill,
    add_comment: t.toolAddComment,
    check_conventions: t.toolCheckConventions,
    measure_text: t.toolMeasureText,
    remember: t.toolRemember,
    generate_image: t.toolGenerateImage,
    search_conversations: t.toolSearchConversations,
    edit_chapters: t.toolEditChapters,
    web_search: t.toolWebSearch,
    web_fetch: t.toolWebFetch,
    search_papers: t.toolSearchPapers,
    // Research's own: a note.
    add_note: t.toolAddNote,
    // …and a part of its question handed to a helper of its own.
    delegate_task: t.toolDelegateTask,
    // Any MCP server's tool.
    mcp: t.toolMcp,
    // Any tool without its own line: a word, not its internal name.
    "*": t.toolWorking,
    // The edit being written, in words, not the raw "propose_edit". The
    // ellipsis is added after it.
    propose_edit: t.proposalStatusStreaming.replace(/…$/, ""),
  };
}

/** A tool call as one readable line: "Reading the section “Methods”"
 *  rather than `read_document`. */
export function toolActivityText(
  name: string,
  argumentsJson: string,
  labels: { toolActivity: Record<string, string> },
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
  // An external agent's step, in its own words.
  if (name === "agent_tool" && typeof args.title === "string" && args.title)
    return args.title;
  // An MCP server's tool, named as the model knows it (mcp_<server>_<tool>),
  // which says whose tool it is.
  if (name.startsWith("mcp_") && labels.toolActivity.mcp)
    return labels.toolActivity.mcp.replace("{arg}", name.slice(4));
  const arg =
    [
      args.query,
      queries,
      site,
      args.heading,
      args.path,
      args.name,
      args.claim,
      args.question,
    ].find((v): v is string => typeof v === "string" && v.length > 0) ??
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
