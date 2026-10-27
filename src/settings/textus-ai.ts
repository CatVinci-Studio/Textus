import type { Settings } from "../prefs/SettingsContext";

/** What Textus AI may do now: the master switch over each feature's own
 *  setting. Always read this, never a feature's setting alone. `inTour`
 *  offers chat in the practice tab even with chat off. */
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
