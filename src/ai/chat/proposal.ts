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
 * if they don't parse or lack what their action requires.
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
    const id = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const block = id(parsed.block);
    const lastBlock = id(parsed.last_block);
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
    return {
      action,
      ...(block ? { block } : {}),
      ...(lastBlock ? { lastBlock } : {}),
      anchor,
      text,
      reason,
    };
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
 * Resolves a leading /name skill invocation: the skill's prompt goes in a
 * <skill> block marked as loaded, so the model doesn't call use_skill again.
 * A slash token that names no skill is left alone. `resolveName` maps IME
 * slashes (`／`, `、`, `・`) and aliases to the canonical name.
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
