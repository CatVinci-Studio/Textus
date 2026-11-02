import { useCallback, useEffect, useRef, useState } from "react";
import type { DocTab } from "../document/doc-tabs";
import { ai } from "../platform/ipc";
import { createTabIdleTimers } from "../document/tab-idle-timers";
import {
  firstContentLine,
  firstLevelOneHeading,
} from "../document/save-default-name";

/** The start of a document is enough to name it, and keeps the request
 *  small; Rust (ai/doc_title.rs) cuts anything longer too. */
export const TITLE_EXCERPT_CHARS = 3000;

/** How long typing rests before an untitled draft is named, in the
 *  background, so Save As and autosave never wait on the AI. */
export const TITLE_IDLE_MS = 4000;

/** Fewer visible characters than this say too little to be named. */
const SHORTEST = 20;

/** The part of the document sent to be named. */
export function titleExcerpt(markdown: string): string {
  let excerpt = markdown.trim().slice(0, TITLE_EXCERPT_CHARS);
  // Never end on half of a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(excerpt)) excerpt = excerpt.slice(0, -1);
  return excerpt;
}

/** Only a document with something written and no level-one heading is
 *  named by the AI: a heading already is its title. */
export function wantsAiTitle(markdown: string): boolean {
  return (
    firstLevelOneHeading(markdown) === null &&
    firstContentLine(markdown) !== null &&
    markdown.replace(/\s/g, "").length >= SHORTEST
  );
}

/** A plain untitled draft the AI may name. */
function namable(tab: DocTab): boolean {
  return (
    !tab.path &&
    !tab.view &&
    !tab.helpDoc &&
    !tab.importedFrom &&
    wantsAiTitle(tab.content)
  );
}

/** What a title was asked for: a draft is named again only once its first
 *  line changes, not on every word added below it. */
function titleBasis(markdown: string): string {
  return firstContentLine(markdown) ?? "";
}

/**
 * Names untitled drafts with the writing model once typing rests, and
 * returns a lookup for the latest title of a tab, or null. `provider` null
 * (AI off, suggested names off) asks nothing.
 */
export function useDraftTitles(
  tabs: DocTab[],
  provider: string | null,
  model: string | null,
): (tab: DocTab) => string | null {
  const [timers] = useState(() =>
    createTabIdleTimers<string>({
      idleMs: TITLE_IDLE_MS,
      same: (a, b) => a === b,
    }),
  );
  const titles = useRef(
    new Map<string, { basis: string; title: string | null }>(),
  );
  const modelRef = useRef({ provider, model });
  modelRef.current = { provider, model };

  useEffect(() => {
    const seen = new Set(tabs.map((tab) => tab.id));
    for (const id of [...titles.current.keys()])
      if (!seen.has(id)) titles.current.delete(id);
    for (const id of timers.ids()) if (!seen.has(id)) timers.cancel(id);
    for (const tab of tabs) {
      const asked = titles.current.get(tab.id);
      if (
        !provider ||
        !namable(tab) ||
        asked?.basis === titleBasis(tab.content)
      ) {
        timers.cancel(tab.id);
        continue;
      }
      timers.schedule(tab.id, tab.content, (content) => {
        const asking = modelRef.current;
        if (!asking.provider) return;
        const basis = titleBasis(content);
        const entry = { basis, title: asked?.title ?? null };
        titles.current.set(tab.id, entry);
        void ai
          .suggestDocTitle({
            provider: asking.provider,
            model: asking.model,
            excerpt: titleExcerpt(content),
          })
          .catch(() => null)
          .then((title) => {
            if (title?.trim()) entry.title = title.trim();
          });
      });
    }
  }, [tabs, provider, timers]);

  useEffect(() => timers.cancelAll, [timers]);

  return useCallback(
    (tab: DocTab) =>
      wantsAiTitle(tab.content)
        ? (titles.current.get(tab.id)?.title ?? null)
        : null,
    [],
  );
}
