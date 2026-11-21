import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { onAppearance } from "../../engine/tokens/appearance";
import { RowHelp } from "../sections/controls";

/** One row's control gone under its name puts every row's there: a group
 *  reads one way (data-stacked on its body). */
function useEvenRows(body: RefObject<HTMLDivElement | null>, on: boolean) {
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || !on) return;
    const fit = () => {
      delete el.dataset.stacked;
      const rows = el.querySelectorAll(":scope > .settings-row");
      const wrapped = [...rows].some((row) => {
        const [name, control] = [row.firstElementChild, row.lastElementChild];
        return (
          name instanceof HTMLElement &&
          control instanceof HTMLElement &&
          name !== control &&
          control.offsetTop > name.offsetTop + 1
        );
      });
      if (wrapped && rows.length > 1) el.dataset.stacked = "";
    };
    fit();
    const resized = new ResizeObserver(fit);
    resized.observe(el);
    const restyled = onAppearance(fit);
    return () => {
      resized.disconnect();
      restyled();
    };
  });
}

/**
 * A section of a Settings page (and of a plugin's page): a small heading,
 * what acts on the whole section at its end (add, import, ⋯), then one flat
 * list of rows. The one box on the page: nothing inside it draws another.
 */
export function SettingsGroup({
  title,
  count,
  help,
  helpLabel,
  actions,
  className,
  evenRows = false,
  cards = false,
  note,
  children,
}: {
  /** None for a page's first section when it would only repeat the page's
   *  own name. */
  title?: string;
  /** How many it lists, after the title. */
  count?: number;
  /** What the section is, behind a "?" after its title (named `helpLabel`,
   *  else the title). */
  help?: ReactNode;
  helpLabel?: string;
  actions?: ReactNode;
  className?: string;
  /** Rows alike (a list of shortcuts): one row's control under its name
   *  puts every row's there. */
  evenRows?: boolean;
  /** A grid of cards (themes), not a list of rows. */
  cards?: boolean;
  /** A line under the list, about the section as a whole. */
  note?: ReactNode;
  /** None while the section is folded: only its head shows. */
  children?: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  useEvenRows(body, evenRows);
  return (
    <section
      className={className ? `settings-group ${className}` : "settings-group"}
      aria-label={title}
    >
      {(title || actions) && (
        <div className="settings-group-head">
          {title && (
            <h2 className="settings-group-title">
              {title}
              {count !== undefined && (
                <span className="settings-group-count" data-search-ignore>
                  {count}
                </span>
              )}
              {help && <RowHelp label={helpLabel ?? title}>{help}</RowHelp>}
            </h2>
          )}
          {actions && <div className="settings-group-actions">{actions}</div>}
        </div>
      )}
      {children && (
        <div
          ref={body}
          className={
            cards ? "settings-group-body settings-cards" : "settings-group-body"
          }
        >
          {children}
        </div>
      )}
      {note && <p className="settings-group-note">{note}</p>}
    </section>
  );
}
