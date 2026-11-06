import { errorText } from "../../utils/error-text";
import type { AgentMode } from "../../prefs/settings-types";
import type { Strings, TextKey } from "../../i18n/strings";

/** What saving a skill the model wrote fails with, then `:` and its
 *  warnings, until the save is confirmed (Rust: ai/workspace/skill_checks.rs). */
const NEEDS_CONFIRM = "SKILL_NEEDS_CONFIRM:";

const WARNINGS: Record<string, TextKey> = {
  "prompt-injection": "skillWarnPromptInjection",
  "hidden-text": "skillWarnHiddenText",
  "create-mode": "skillWarnCreateMode",
};

/** The warnings in a NEEDS_CONFIRM error, or null for any other error. */
export function warningsIn(err: unknown): string[] | null {
  const text = errorText(err);
  return text.startsWith(NEEDS_CONFIRM)
    ? text.slice(NEEDS_CONFIRM.length).split(",").filter(Boolean)
    : null;
}

export function warningText(t: Strings, warning: string): string {
  const key = WARNINGS[warning];
  return key ? t[key] : warning;
}

/** Warnings shown for these modes; confirmed only for them, so ticking
 *  Create afterwards asks again. */
export interface Confirming {
  warnings: string[];
  modes: AgentMode[];
}

export function confirmedFor(
  confirming: Confirming | null,
  modes: AgentMode[],
): Confirming | null {
  return confirming &&
    confirming.modes.length === modes.length &&
    confirming.modes.every((m) => modes.includes(m))
    ? confirming
    : null;
}
