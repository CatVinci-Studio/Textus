/**
 * Front matter read and written with a full YAML parser, for plugins: block
 * text, lists of maps, anchors and quoting all come back as YAML means them,
 * and a change keeps every comment and the other keys as written. Loaded on
 * first use (the parser is too large for startup); the app's own index keeps
 * the light reader in frontmatter.ts.
 */
import { parse, parseDocument, stringify } from "yaml";
import {
  parseFrontmatter,
  splitFrontmatter,
  withFrontmatter,
  type Frontmatter,
} from "./frontmatter";

const isMap = (value: unknown): value is Frontmatter =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** YAML text as an object: {} for none or for YAML that isn't a map. */
export function parseYamlFull(yaml: string): Frontmatter {
  const value: unknown = parse(yaml);
  return isMap(value) ? value : {};
}

/** Data as YAML, without a trailing line break. */
export function stringifyYamlFull(data: unknown): string {
  return stringify(data).replace(/\n$/, "");
}

/** A document's front matter as an object; YAML the parser refuses is read
 *  by the light reader, as the app reads it. */
export function readFrontmatterFull(text: string): Frontmatter {
  const { yaml } = splitFrontmatter(text);
  if (yaml === null) return {};
  try {
    return parseYamlFull(yaml);
  } catch {
    return parseFrontmatter(text);
  }
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** `text` with its front matter set to `data`: changed keys are written in
 *  place, gone ones removed, new ones added at the end, and everything else
 *  - comments, order, quoting - stays as written. */
export function writeFrontmatterFull(text: string, data: Frontmatter): string {
  const { yaml, body } = splitFrontmatter(text);
  const keys = Object.keys(data).filter((key) => data[key] !== undefined);
  if (yaml === null || !keys.length) return withFrontmatter(text, data);
  const doc = parseDocument(yaml);
  if (doc.errors.length) return withFrontmatter(text, data);
  const was: unknown = doc.toJS();
  if (was !== null && !isMap(was)) return withFrontmatter(text, data);
  const current = isMap(was) ? was : {};
  for (const key of Object.keys(current))
    if (!keys.includes(key)) doc.delete(key);
  for (const key of keys)
    if (!same(current[key], data[key])) doc.set(key, data[key]);
  return `---\n${doc.toString().replace(/\n+$/, "")}\n---\n${body}`;
}
