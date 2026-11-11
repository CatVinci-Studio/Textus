import { counted as inWords } from "../../i18n/current";
import { fill } from "../../i18n/fill";
import { cornerKey } from "../../engine/frame/island-parts";
import { useDeferredValue, useMemo, type CSSProperties } from "react";
import { countWords } from "../../utils/word-count";
import { PAUSE_FEATURES_THRESHOLD } from "../../editor/large-doc";
import { showsStartPage, type DocTab } from "../../document/doc-tabs";
import { Tooltip } from "../../engine/controls/Tooltip";
import type { Lang } from "../../i18n/langs";
import type { Strings } from "../../i18n/strings";
import "./document-corner.css";

/** Where writers count characters, not words: Japanese's 文字数. Chinese
 *  字数 is already one per character in the word count. */
const BY_CHARACTERS: ReadonlySet<Lang> = new Set(["ja"]);

/** A document's own text, which a word count means something for: not a
 *  plugin's view, a web page or the start page. */
function counted(tab: DocTab | undefined): tab is DocTab {
  return !!tab && !tab.view && !showsStartPage(tab);
}

/**
 * A document's readouts at its page's bottom right, each island its own -
 * with several open the window bar couldn't say whose they were: its
 * length as its language counts it (the breakdown on hover), and the large
 * document note while some features rest. `style` is its island's sheet,
 * whose bottom right it keeps; it moves with that sheet (`frame`).
 */
function DocumentCorner({
  tabId,
  content,
  lang,
  style,
  frame,
  t,
}: {
  /** Its tab: a drag hides the corner of the document it carries. */
  tabId: string;
  content: string;
  lang: Lang;
  style?: CSSProperties;
  frame: string;
  t: Strings;
}) {
  // Deferred, so a whole-document count doesn't sit in the edit's render.
  const deferred = useDeferredValue(content);
  const count = useMemo(() => countWords(deferred), [deferred]);
  const large = content.length > PAUSE_FEATURES_THRESHOLD;
  const shown = BY_CHARACTERS.has(lang) ? count.characters : count.words;
  if (!shown && !large) return null;
  const detail = fill(t.wordCountDetail, {
    words: String(count.words),
    characters: String(count.characters),
  });
  return (
    <div
      className="document-corner"
      data-corner-of={tabId}
      data-frame={frame}
      style={style}
    >
      {large && (
        <Tooltip text={t.largeDocHint}>
          <span className="large-doc-badge">{t.largeDocBadge}</span>
        </Tooltip>
      )}
      {shown > 0 && (
        <Tooltip text={detail} side="above">
          <span className="word-count" tabIndex={-1}>
            {inWords(t.wordCount, shown)}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

/** Each island's front document's corner (`style` its pane's cell). */
export function DocumentCorners({
  fronts,
  lang,
  t,
}: {
  fronts: { tab: DocTab | undefined; style?: CSSProperties; frame: string }[];
  lang: Lang;
  t: Strings;
}) {
  return fronts.map(
    ({ tab, style, frame }) =>
      counted(tab) && (
        <DocumentCorner
          key={tab.id}
          tabId={tab.id}
          content={tab.content}
          lang={lang}
          style={style}
          frame={cornerKey(frame)}
          t={t}
        />
      ),
  );
}
