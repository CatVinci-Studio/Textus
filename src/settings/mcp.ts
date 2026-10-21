/**
 * MCP servers as Settings keeps them (`mcpServers`, read by src-tauri
 * mcp/mod.rs): a program to start, or a URL to reach, each with its own
 * switch. Settings › Extensions › MCP edits them.
 */

export interface McpServer {
  /** Stable, made when it is added. */
  id: string;
  name: string;
  enabled: boolean;
  /** The program to start (npx, uvx, a path) - or "" for a URL. */
  command: string;
  args: string[];
  env: Record<string, string>;
  /** A Streamable HTTP endpoint - or "" for a command. */
  url: string;
  headers: Record<string, string>;
}

/** Ready-made servers to add: what most people connect first. Each starts
 *  with the command its own README gives. */
export interface McpPreset {
  id: string;
  name: string;
  /** What it gives Textus AI, by language code; English for the rest. */
  description: Record<string, string>;
  command: string;
  args: string[];
  /** What the user must fill in before it can start, shown in the form. */
  needs?: "folder" | "key";
  homepage: string;
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "filesystem",
    name: "Filesystem",
    description: {
      en: "Reads and writes files in a folder you choose.",
      zh: "读写你指定的文件夹里的文件。",
    },
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    needs: "folder",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "fetch",
    name: "Fetch",
    description: {
      en: "Reads a web page and gives it back as Markdown.",
      zh: "读取网页，并转成 Markdown 交给 AI。",
    },
    command: "uvx",
    args: ["mcp-server-fetch"],
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
  },
  {
    id: "memory",
    name: "Memory",
    description: {
      en: "A knowledge graph Textus AI keeps notes in across conversations.",
      zh: "一个知识图谱，Textus AI 可以在不同对话之间记笔记。",
    },
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
  },
  {
    id: "time",
    name: "Time",
    description: {
      en: "The current time and conversions between time zones.",
      zh: "当前时间，以及时区之间的换算。",
    },
    command: "uvx",
    args: ["mcp-server-time"],
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
  },
];

/** A preset's description in `lang`, else English. */
export function presetDescription(preset: McpPreset, lang: string): string {
  return preset.description[lang.split("-")[0]] ?? preset.description.en;
}

/** A command line split into its words: spaces separate them, except in
 *  quotes ("…" or '…'), and a backslash keeps the next character. */
export function splitCommandLine(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: string | null = null;
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && i + 1 < line.length && quote !== "'") {
      word += line[++i];
      started = true;
    } else if (quote) {
      if (c === quote) quote = null;
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += c;
      started = true;
    }
  }
  if (started) words.push(word);
  return words;
}

/** Words as a command line, quoting the ones that need it. */
export function joinCommandLine(words: string[]): string {
  return words
    .map((w) => (w === "" || /[\s"'\\]/.test(w) ? JSON.stringify(w) : w))
    .join(" ");
}

/** `KEY=value` lines as a record; blank lines and lines without `=` are
 *  left out. */
export function parsePairs(
  text: string,
  separator = "=",
): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf(separator);
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (key) pairs[key] = line.slice(at + separator.length).trim();
  }
  return pairs;
}

export function formatPairs(
  pairs: Record<string, string>,
  separator = "=",
): string {
  return Object.entries(pairs)
    .map(([k, v]) => `${k}${separator}${v}`)
    .join("\n");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

/** Stored servers, as far as they are well formed. */
export function normaliseMcpServers(value: unknown): McpServer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): McpServer[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== "string" || !s.id) return [];
    return [
      {
        id: s.id,
        name: typeof s.name === "string" ? s.name : s.id,
        enabled: s.enabled === true,
        command: typeof s.command === "string" ? s.command : "",
        args: Array.isArray(s.args)
          ? s.args.filter((a): a is string => typeof a === "string")
          : [],
        env: isStringRecord(s.env) ? s.env : {},
        url: typeof s.url === "string" ? s.url : "",
        headers: isStringRecord(s.headers) ? s.headers : {},
      },
    ];
  });
}
