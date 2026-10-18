import type { Strings } from "../../i18n/strings";
import type { RevisionDisplay } from "../../settings/SettingsContext";

/** A revision display's name, for the settings list and the review bar's
 *  menu. */
export function revisionDisplayName(t: Strings, mode: RevisionDisplay): string {
  return {
    inline: t.revisionDisplayInline,
    original: t.revisionDisplayOriginal,
    new: t.revisionDisplayNew,
    final: t.revisionDisplayFinal,
  }[mode];
}

/** Whether a display puts one side of each change in the margin. */
export function needsMargin(mode: RevisionDisplay): boolean {
  return mode === "original" || mode === "new";
}

/**
 * The display actually drawn: the margin views need a margin, and fall
 * back to everything in the text where there is none (a narrow window, a
 * phone). The chosen display is kept, and applies again once there is.
 */
export function effectiveRevisionDisplay(
  mode: RevisionDisplay,
  hasMargin: boolean,
): RevisionDisplay {
  return !hasMargin && needsMargin(mode) ? "inline" : mode;
}
