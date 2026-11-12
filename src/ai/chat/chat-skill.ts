import { splitFrontmatter } from "../../utils/frontmatter";
import type { AgentMode } from "../../prefs/settings-values";
import { storedAgentMode } from "../../prefs/settings-values";
import { replyFiles } from "./reply-files";

/**
 * A skill Textus AI wrote in a reply: one fenced block such as
 * ```markdown weekly-report.md whose text is a skill file with a `name`.
 */
export interface ReplySkill {
  name: string;
  description: string;
  /** What it says it is called in each UI language (`textus-label-<code>`). */
  labels: Record<string, string>;
  /** The modes its file asks for, Create left out - a skill there could
   *  write the next skill, so only the user ticks it; Write when none. */
  modes: AgentMode[];
  /** Its file asked for Create mode. */
  asksForCreate: boolean;
  /** The whole file, as it is saved. */
  text: string;
}

/** A front matter value: `key: value` or `key: "value"`, at any indent. */
function field(front: string, key: string): string | null {
  const m = new RegExp(`^\\s*${key}:\\s*(.*)$`, "m").exec(front);
  if (!m) return null;
  return m[1].trim().replace(/^"(.*)"$/, "$1");
}

/** A folded `description: >-` block, or a one-line one. */
function description(front: string): string {
  const folded = /^description:\s*>-?\s*\n((?:[ \t]+.*\n?)+)/m.exec(front);
  if (folded)
    return folded[1]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ");
  return field(front, "description") ?? "";
}

/** The skills `text` writes: each `.md` block that is a skill file. */
export function skillsInReply(text: string): ReplySkill[] {
  const skills: ReplySkill[] = [];
  for (const { path, text: file } of replyFiles(text)) {
    if (!path?.endsWith(".md")) continue;
    const { yaml, body } = splitFrontmatter(file);
    if (yaml === null) continue;
    const name = field(yaml, "name");
    if (!name || !body.trim()) continue;
    const labels: Record<string, string> = {};
    for (const l of yaml.matchAll(/^\s*textus-label-([\w-]+):\s*(.*)$/gm))
      labels[l[1]] = l[2].trim().replace(/^"(.*)"$/, "$1");
    const modes = (field(yaml, "textus-modes") ?? "")
      .split(/[\s,]+/)
      .map(storedAgentMode)
      .filter((mode): mode is AgentMode => mode !== null);
    const picked = [...new Set(modes)].filter((mode) => mode !== "create");
    skills.push({
      name,
      description: description(yaml),
      labels,
      modes: picked.length ? picked : ["write"],
      asksForCreate: modes.includes("create"),
      text: file,
    });
  }
  return skills;
}
