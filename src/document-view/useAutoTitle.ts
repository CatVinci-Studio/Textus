import { useEffect, useRef } from "react";
import { suggestTitle } from "../ai/workspace/assist";
import { firstLevelOneHeading } from "../document/save-default-name";
import { hasSuggestedTitle, setSuggestedTitle } from "../document/doc-tabs";
import type { Settings } from "../settings/SettingsContext";
import { useLatest } from "../utils/hooks/useLatest";

/** Enough text to say what a document is about. */
const MIN_CHARS = 60;
/** Quiet time after the last change before asking. */
const SETTLE_MS = 2500;

/**
 * Settings > Name new documents automatically: an unsaved document without
 * a level-one heading, once it holds some text, gets a title suggested by
 * the text model for its tab and the Save dialog (the text is not edited).
 * Fed every content change - typed, accepted from a draft, restored from a
 * past task - rather than only the first accepted draft, which left a
 * document whose text arrived any other way "Untitled" for good. One
 * request per document; a failed one is retried on the next change.
 */
export function useAutoTitle(
  tabId: string,
  filePath: string | null,
  settings: Settings,
  initialValue: string,
): (markdown: string) => void {
  const latest = useLatest({ tabId, filePath, settings });
  const state = useRef({
    timer: null as ReturnType<typeof setTimeout> | null,
    asking: false,
    done: false,
  });
  const noteContent = useRef((markdown: string) => {
    const { tabId, filePath, settings } = latest.current;
    const s = state.current;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    if (
      s.done ||
      s.asking ||
      filePath ||
      !settings.autoTitleDocuments ||
      hasSuggestedTitle(tabId)
    )
      return;
    const text = markdown.trim();
    if ([...text].length < MIN_CHARS || firstLevelOneHeading(text)) return;
    s.timer = setTimeout(() => {
      s.timer = null;
      s.asking = true;
      void suggestTitle(latest.current.settings, text)
        .then((title) => {
          if (!title) return;
          s.done = true;
          setSuggestedTitle(latest.current.tabId, title);
        })
        .catch(() => {})
        .finally(() => {
          s.asking = false;
        });
    }, SETTLE_MS);
  }).current;
  // Text the document opened with (a restored session, a past task's
  // snapshot) counts too.
  useEffect(() => {
    noteContent(initialValue);
    const s = state.current;
    return () => {
      if (s.timer) clearTimeout(s.timer);
    };
    // Once, for the text the editor mounted with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return noteContent;
}
