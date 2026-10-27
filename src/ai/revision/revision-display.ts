import type { Strings } from "../../i18n/strings";
import type { RevisionDisplay } from "../../prefs/SettingsContext";
import type { EditProposal } from "../types";

/** A revision display's name, for the settings list and the review bar's
 *  menu. */
export function revisionDisplayName(t: Strings, mode: RevisionDisplay): string {
  return {
    inline: t.revisionDisplayInline,
    original: t.revisionDisplayOriginal,
    final: t.revisionDisplayFinal,
  }[mode];
}

/** Whether a display puts the new side of each change in the margin: a
 *  phone, which never has one, doesn't offer it. */
export function needsMargin(mode: RevisionDisplay): boolean {
  return mode === "original";
}

/** Whether a display shows part of each change in the margin, and so falls
 *  back where there is none. On a phone Result only reads as the result. */
export function usesMargin(mode: RevisionDisplay, phone = false): boolean {
  return needsMargin(mode) || (mode === "final" && !phone);
}

/** The display actually drawn: margin views fall back to everything in the
 *  text where there's no margin, the choice kept for when there is. */
export function effectiveRevisionDisplay(
  mode: RevisionDisplay,
  marginAvailable: boolean,
  phone = false,
): RevisionDisplay {
  return !marginAvailable && usesMargin(mode, phone) ? "inline" : mode;
}

/** Whether a margin view is listed but can't be picked for want of room. A
 *  phone lists only views needing no margin, so nothing there is blocked. */
export function marginViewBlocked(
  mode: RevisionDisplay,
  { phone, marginAvailable }: { phone: boolean; marginAvailable: boolean },
): boolean {
  return !phone && !marginAvailable && usesMargin(mode);
}

/** Whether a proposal only adds text: with no original to set beside it,
 *  it is drawn in the text in every view. */
export function addsTextOnly(proposal: EditProposal): boolean {
  return (
    proposal.action === "append" ||
    proposal.action === "insert_at_cursor" ||
    proposal.action === "insert_before" ||
    proposal.action === "insert_after"
  );
}
