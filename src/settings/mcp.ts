/** MCP servers as Settings keeps them: a program to start, or a URL to
 *  reach, each with its own switch. */

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
