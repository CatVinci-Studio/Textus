import { useMemo } from "react";
import { useSettings } from "../prefs/SettingsContext";
import { parseHeadings } from "./outline-parse";
import { goToHeading } from "./outline-current";
import { plainInline } from "../utils/markdown-plain";

/** How many of the document's headings a search lists. */
const MOST = 8;

/**
 * The open document's headings that match the search, a jump each - its
 * outline searched where its files are (iA Writer's quick search), so a
 * phone needn't open the outline from ⋯.
 */
export function HeadingMatches({
  content,
  tabId,
  query,
}: {
  content: string;
  tabId: string;
  query: string;
}) {
  const { t } = useSettings();
  const needle = query.trim().toLocaleLowerCase();
  const matches = useMemo(
    () =>
      needle
        ? parseHeadings(content)
            .map((h, index) => ({ ...h, index, plain: plainInline(h.text) }))
            .filter((h) => h.plain.toLocaleLowerCase().includes(needle))
            .slice(0, MOST)
        : [],
    [content, needle],
  );
  if (matches.length === 0) return null;
  return (
    <section className="search-headings" aria-label={t.searchHeadingsHeading}>
      <h3 className="tx-list-heading">{t.searchHeadingsHeading}</h3>
      {matches.map((h) => (
        <button
          key={h.index}
          type="button"
          className="tree-row search-heading-row"
          style={{ paddingInlineStart: `calc(var(--tree-step) * ${h.level})` }}
          onClick={() => goToHeading(tabId, h.index)}
        >
          <span className="tx-truncate tree-label">{h.plain}</span>
        </button>
      ))}
    </section>
  );
}
