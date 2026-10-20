import type { Settings } from "./SettingsContext";

/** What Textus AI may do right now: Settings.textusAi, the master switch,
 *  over each feature's own setting. Read this, never a feature's setting
 *  alone, to decide whether to offer or run a feature - turned off, the
 *  switch has to win at every entry point (a menu, a shortcut, typing).
 *  The tour's practice tab offers the conversation even with chat turned
 *  off (`inTour`), but never with Textus AI off. */
export function aiFeatures(
  settings: Pick<
    Settings,
    "textusAi" | "enableCompletion" | "enableGrammarCheck" | "enableAskAi"
  >,
  inTour = false,
) {
  const on = settings.textusAi;
  return {
    on,
    completion: on && settings.enableCompletion,
    grammar: on && settings.enableGrammarCheck,
    chat: on && (settings.enableAskAi || inTour),
  };
}
