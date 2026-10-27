import type { CompletionTone } from "../../prefs/SettingsContext";

/// English directives whatever the UI language, like the backend prompts.
const TONE_DIRECTIVES: Record<CompletionTone, string | null> = {
  default: null,
  formal: "Write in a formal, polished tone.",
  casual:
    "Write in a relaxed, conversational tone - everyday words, contractions and short sentences, the way you would say it to a colleague; in Chinese, spoken 口语 rather than written 书面语.",
  academic:
    "Write in a precise, academic tone appropriate for scholarly writing.",
  concise:
    "Be as concise as possible - the fewest plain words that carry the point, at the short end of the length above.",
};

/** The tone as a directive for the completion prompt, or null when unset. */
export function buildCompletionStyle(tone: CompletionTone): string | null {
  return TONE_DIRECTIVES[tone];
}
