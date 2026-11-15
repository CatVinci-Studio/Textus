/**
 * Textus's own approval switch, for an agent with no mode that asks first
 * (OpenCode, DeepSeek Harness): it asks through permission requests, and
 * with "Allow all" chosen Textus answers them itself. An agent with such a
 * mode (Claude Code, Codex, Gemini CLI) is switched by its own.
 */

import type { Strings } from "../../i18n/strings";
import { loadSettings } from "../../prefs/settings-store";
import type { PermissionOption, PermissionOutcome } from "./acp-client";
import { askingValue, type AgentOption } from "./agent-mode";
import { offerOf } from "./agent-offers";

export const APPROVAL = "textus-approval";

/** Whether `options` already hold a way to ask first: a mode that does, or
 *  an allow-all switch of the agent's own. */
const asksItself = (options: readonly AgentOption[]) =>
  askingValue(options) !== null ||
  options.some((o) => o.category === "permissions");

/** The switch for an agent offering `options`; null when its own mode
 *  does the job, or before it has been heard. */
export function approvalOption(
  options: readonly AgentOption[],
  t: Strings,
): AgentOption | null {
  if (options.length === 0 || asksItself(options)) return null;
  return {
    id: APPROVAL,
    name: t.agentApproval,
    category: "approval",
    current: "ask",
    choices: [
      { value: "ask", name: t.agentAskFirst, description: t.agentAskFirstHint },
      {
        value: "allow",
        name: t.agentAllowAll,
        description: t.agentAllowAllHint,
      },
    ],
  };
}

/** `agent`'s permission request answered unasked: its allow-once while
 *  the user allowed all; null to ask. */
export function allowedUnasked(
  agent: string,
  options: readonly PermissionOption[],
): Promise<PermissionOutcome> | null {
  const offered = offerOf(agent).options;
  if (offered.length === 0 || asksItself(offered)) return null;
  if (loadSettings().agentOptions[agent]?.[APPROVAL] !== "allow") return null;
  const allow = options.find((o) => o.kind === "allow_once");
  return allow
    ? Promise.resolve({
        outcome: { outcome: "selected", optionId: allow.optionId },
      })
    : null;
}
