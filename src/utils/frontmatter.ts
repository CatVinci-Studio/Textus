/**
 * The YAML front matter of a document, read into an object and written back,
 * the rest untouched. Covers what notes hold in practice; a line it can't
 * read is kept as it was.
 */

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

export type Frontmatter = Record<string, FrontmatterValue>;

const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** The front matter block and what follows it. */
export function splitFrontmatter(text: string): {
  yaml: string | null;
  body: string;
} {
  const m = FENCE.exec(text);
  if (!m) return { yaml: null, body: text };
  return { yaml: m[1], body: text.slice(m[0].length) };
}

function scalar(raw: string): FrontmatterValue {
  const v = raw.trim();
  if (v === "" || v === "~" || v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    const inner = v.slice(1, -1);
    return v.startsWith('"')
      ? inner.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\")
      : inner.replace(/''/g, "'");
  }
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    return inner ? splitFlow(inner).map(scalar) : [];
  }
  return v;
}

/** `a, "b, c", d` split at the commas outside quotes. */
function splitFlow(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const c of text) {
    if (quote) {
      current += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if (c === ",") {
      out.push(current);
      current = "";
    } else current += c;
  }
  out.push(current);
  return out.map((s) => s.trim());
}

/** The front matter of `text` as an object; {} when it has none. */
export function parseFrontmatter(text: string): Frontmatter {
  const { yaml } = splitFrontmatter(text);
  return yaml === null ? {} : parseYaml(yaml);
}

export function parseYaml(yaml: string): Frontmatter {
  const out: Frontmatter = {};
  const lines = yaml.split(/\r?\n/);
  let key: string | null = null;
  let nested: Record<string, FrontmatterValue> | null = null;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s+-\s*(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (item && key) {
      const list = Array.isArray(out[key])
        ? (out[key] as FrontmatterValue[])
        : [];
      list.push(scalar(item[1]));
      out[key] = list;
      continue;
    }
    const sub = /^\s+([^:#]+):\s*(.*)$/.exec(line);
    if (sub && key && nested) {
      nested[sub[1].trim()] = scalar(sub[2]);
      continue;
    }
    const top = /^([^\s:#][^:]*):\s*(.*)$/.exec(line);
    if (top) {
      key = top[1].trim();
      if (top[2].trim() === "") {
        nested = {};
        out[key] = nested;
      } else {
        nested = null;
        out[key] = scalar(top[2]);
      }
    }
  }
  // A key with nothing under it is null, not an empty map.
  for (const [k, v] of Object.entries(out))
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      !Object.keys(v).length
    )
      out[k] = null;
  return out;
}

function quote(value: string): string {
  if (
    value === "" ||
    /^[\s-?:,[\]{}#&*!|>'"%@`]|[:#]\s|\s$|^(true|false|null|~|-?\d+(\.\d+)?)$/.test(
      value,
    ) ||
    value.includes("\n")
  )
    return JSON.stringify(value);
  return value;
}

function inline(value: FrontmatterValue): string {
  if (value === null) return "";
  if (typeof value === "string") return quote(value);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  return JSON.stringify(value);
}

export function stringifyYaml(data: Frontmatter): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(value))
        lines.push(`  ${k}: ${inline(v)}`.trimEnd());
    } else if (Array.isArray(value) && value.length > 3) {
      lines.push(`${key}:`);
      for (const v of value) lines.push(`  - ${inline(v)}`.trimEnd());
    } else lines.push(`${key}: ${inline(value)}`.trimEnd());
  }
  return lines.join("\n");
}

/** `text` with its front matter set to `data`: added at the top if it
 *  had none, taken away when `data` is empty. */
export function withFrontmatter(text: string, data: Frontmatter): string {
  const { yaml, body } = splitFrontmatter(text);
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!keys.length) return yaml === null ? text : body;
  const block = `---\n${stringifyYaml(data)}\n---\n`;
  return yaml === null
    ? `${block}${text.length ? `\n${text}` : ""}`
    : block + body;
}
