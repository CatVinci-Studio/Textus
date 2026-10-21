import { normalizeMathDelimiters } from "../../utils/markdown-math";
import { withoutCitationMarkers } from "../citation-markers";
import { skillBlock } from "./user-message";
import { SKILL_COMMAND } from "./skill-picker";
import { parseImageProposal } from "../revision/generated-images";
import {
  EDIT_ACTIONS,
  type AgentSkill,
  type EditAction,
  type EditProposal,
} from "../types";

/**
 * A propose_edit tool call's arguments as a validated EditProposal, or null
 * if they don't parse or are missing what their action requires (same rules
 * the backend tool validates against).
 */
export function parseProposal(argumentsJson: string): EditProposal | null {
  try {
    const parsed = JSON.parse(argumentsJson);
    const action = parsed.action as EditAction;
    if (!EDIT_ACTIONS.includes(action)) return null;
    const anchor =
      typeof parsed.anchor === "string" && parsed.anchor
        ? parsed.anchor
        : undefined;
    // Only the inserted text, never the anchor - the anchor must stay a
    // verbatim quote of the document to match.
    const text =
      typeof parsed.text === "string"
        ? normalizeMathDelimiters(withoutCitationMarkers(parsed.text))
        : undefined;
    // Like the anchor, kept verbatim - it must match the document exactly.
    const context =
      typeof parsed.context === "string" && parsed.context
        ? parsed.context
        : undefined;
    if (
      action !== "append" &&
      action !== "replace_selection" &&
      action !== "insert_at_cursor" &&
      !anchor
    )
      return null;
    if (action !== "delete" && text === undefined) return null;
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : undefined;
    return { action, anchor, text, context, reason };
  } catch {
    return null;
  }
}

/** The tools whose calls are proposals: propose_edit, and generate_image,
 *  whose picture is proposed like an insertion. */
export function isProposalTool(name: string): boolean {
  return name === "propose_edit" || name === "generate_image";
}

/** A proposal tool call's arguments as an EditProposal, or null. */
export function parseToolProposal(
  name: string,
  argumentsJson: string,
): EditProposal | null {
  if (name === "propose_edit") return parseProposal(argumentsJson);
  if (name === "generate_image") return parseImageProposal(argumentsJson);
  return null;
}

/**
 * Resolves a leading /name skill invocation: the skill's prompt becomes the
 * message body, in a <skill> block that tells the model it is already
 * loaded (agent.rs's skill index says so - sent bare, the model called
 * use_skill for it again, a 12-16 s round trip in the live eval), with
 * whatever followed the name appended as extra input. A slash token that
 * doesn't name a skill is left alone - it might just be text that starts
 * with a slash. The transcript shows it as the /word the user typed
 * (user-message.ts's parseUserMessage).
 *
 * The slash may be what a CJK IME types for that key (`／`, or a leading
 * `、` or `・`), and the word may be an alias (`/续写`): `resolveName` maps it to
 * the canonical name. A skill the workspace has no prompt for (a built-in
 * the backend expands) goes out as an empty block naming it.
 */
export function resolveSkillMessage(
  message: string,
  skills: AgentSkill[],
  resolveName?: (token: string) => string | null,
): string {
  const m = SKILL_COMMAND.exec(message);
  if (!m) return message;
  const token = m[1];
  const name = skills.some((s) => s.name === token)
    ? token
    : (resolveName?.(token) ?? null);
  if (!name) return message;
  const prompt = skills.find((s) => s.name === name)?.prompt ?? "";
  const body = skillBlock(name, prompt, `/${token}`);
  const rest = m[2]?.trim();
  return rest ? `${body}\n\n${rest}` : body;
}
