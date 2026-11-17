import { createSubscribers } from "../../utils/store";

/**
 * Inline syntax plugins teach the editor to show: `||spoiler||`,
 * `{漢字|かんじ}`. Only how the words look changes; the text stays as written,
 * and an export keeps it.
 */

const SYNTAX_STYLES = [
  "highlight",
  "underline",
  "muted",
  "spoiler",
  "ruby",
] as const;
type SyntaxStyle = (typeof SYNTAX_STYLES)[number];

const TONES = ["accent", "warning", "danger", "success"] as const;
type Tone = (typeof TONES)[number];

export interface PluginSyntax {
  pattern: RegExp;
  style: SyntaxStyle;
  tone: Tone;
}

/** By the plugin and the syntax's own id. */
const syntaxes = new Map<string, PluginSyntax>();
let all: readonly PluginSyntax[] = [];
const subscribers = createSubscribers();

function changed() {
  all = [...syntaxes.values()];
  subscribers.publish();
}

/** The pattern a plugin sent, ready to find every match with its groups'
 *  places; null when it isn't one, or can match nothing at all. */
export function syntaxPattern(source: string, flags = ""): RegExp | null {
  const kept = [...new Set(flags)].filter((f) => "imsu".includes(f)).join("");
  let pattern: RegExp;
  try {
    pattern = new RegExp(source, `${kept}gd`);
  } catch {
    return null;
  }
  return source && !pattern.test("") ? pattern : null;
}

/** Adds (or replaces) a syntax; false when its pattern or style isn't
 *  one Textus can use. */
export function addSyntax(
  key: string,
  syntax: { pattern: string; flags?: string; style: string; tone?: string },
): boolean {
  const pattern = syntaxPattern(syntax.pattern, syntax.flags);
  const style = SYNTAX_STYLES.find((s) => s === syntax.style);
  if (!pattern || !style) return false;
  const tone = TONES.find((t) => t === syntax.tone) ?? "accent";
  syntaxes.set(key, { pattern, style, tone });
  changed();
  return true;
}

export function removeSyntaxes(match: (key: string) => boolean): void {
  let removed = false;
  for (const key of syntaxes.keys())
    if (match(key)) removed = syntaxes.delete(key) || removed;
  if (removed) changed();
}

/** Every syntax, as one list that is replaced (not changed) when a plugin
 *  adds or takes one away. */
export const pluginSyntaxes = (): readonly PluginSyntax[] => all;

export const onPluginSyntaxes = subscribers.subscribe;
