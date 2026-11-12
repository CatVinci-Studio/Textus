import type { ReactNode } from "react";
import { fill } from "../../i18n/fill";
import type { Strings } from "../../i18n/strings";
import { explainError } from "../../utils/error-explain";
import { loadCatalog, type CatalogState } from "../../plugins/store/catalog";

/** The plugin and skill catalog's state as catalogMessage reads it. */
export const catalogStatus = (catalog: CatalogState) =>
  catalog.status === "ready" || catalog.status === "failed"
    ? catalog.status
    : "loading";

/** Why a catalog couldn't be read, or why it is only the copy kept, with a
 *  button to try again (and `extra`, another way on). */
export function CatalogProblem({
  t,
  text,
  retry = () => void loadCatalog(true),
  extra,
}: {
  t: Strings;
  text: string;
  retry?: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className="settings-row plugin-catalog-problem">
      <div className="settings-row-text">
        <div className="settings-error">{text}</div>
      </div>
      <div className="settings-row-control">
        <button
          type="button"
          className="text-button settings-inline-button"
          onClick={retry}
        >
          {t.pluginsCatalogRetry}
        </button>
        {extra}
      </div>
    </div>
  );
}

/**
 * What a catalog's list says in place of its rows, one way for plugins,
 * skills and themes: loading, failed (with Try again), empty, or nothing
 * matching the search; undefined when it has rows to show.
 */
export function catalogMessage({
  t,
  status,
  error,
  retry,
  extra,
  none,
  query,
  shown,
}: {
  t: Strings;
  status: "loading" | "failed" | "ready";
  error?: unknown;
  retry?: () => void;
  extra?: ReactNode;
  /** Said when the catalog lists nothing at all. */
  none?: string;
  query: string;
  /** How many rows show for the search. */
  shown: number;
}): ReactNode {
  if (status === "failed")
    return (
      <CatalogProblem
        t={t}
        text={fill(t.pluginsCatalogFailed, {
          reason: explainError(error, t),
        })}
        retry={retry}
        extra={extra}
      />
    );
  if (status === "loading")
    return <p className="tx-list-note">{t.pluginsCatalogLoading}</p>;
  if (query.trim() && !shown)
    return (
      <p className="tx-list-note">
        {fill(t.pluginsSearchNone, { query: query.trim() })}
      </p>
    );
  if (none && !shown) return <p className="tx-list-note">{none}</p>;
  return undefined;
}
