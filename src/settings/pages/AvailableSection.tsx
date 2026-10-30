import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Strings } from "../../i18n/strings";
import { getUiState, setUiState } from "../../storage/ui-state";

/** Rows shown at first, and how many more come as the list's end
 *  scrolls into sight. */
const FIRST = 8;
const MORE = 12;

function foldedKinds(): string[] {
  const kinds = getUiState("extensionsFolded");
  return Array.isArray(kinds) ? kinds : [];
}

/** Below what is installed: what could be. Folds away, remembered per
 *  kind; a long list grows as it is scrolled. `head` sits beside the title
 *  (a sort), `message` stands in for the rows (loading, a fetch failed). */
export function AvailableSection({
  t,
  kind,
  rows,
  head,
  note,
  message,
  searching,
}: {
  t: Strings;
  kind: string;
  rows: ReactNode[];
  head?: ReactNode;
  /** Above the rows: the list kept from last time, say. */
  note?: ReactNode;
  message?: ReactNode;
  /** A search shows every match at once. */
  searching: boolean;
}) {
  const [folded, setFolded] = useState(() => foldedKinds().includes(kind));
  const [limit, setLimit] = useState(FIRST);
  const toggle = () => {
    const next = !folded;
    setFolded(next);
    const others = foldedKinds().filter((k) => k !== kind);
    setUiState("extensionsFolded", next ? [...others, kind] : others);
  };
  const shown = searching ? rows : rows.slice(0, limit);
  const left = rows.length - shown.length;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + MORE);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [left, folded]);
  return (
    <section className="settings-group extensions-available">
      <div className="extensions-available-head">
        <h2 className="settings-group-title">
          {t.extensionsAvailable}
          {!message && <span className="extensions-count">{rows.length}</span>}
        </h2>
        {!folded && head}
        <button
          type="button"
          className="text-button settings-inline-button"
          aria-expanded={!folded}
          onClick={toggle}
        >
          {folded ? t.extensionsUnfold : t.extensionsFold}
        </button>
      </div>
      {!folded && (
        <div className="settings-group-body">
          {!message && note}
          {message ?? shown}
          {!message && left > 0 && (
            <div ref={end} className="extensions-more-rows" aria-hidden />
          )}
        </div>
      )}
    </section>
  );
}
