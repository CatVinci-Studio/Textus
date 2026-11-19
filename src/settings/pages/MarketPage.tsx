import type { ReactNode } from "react";
import { HeadRow } from "../../engine/controls/HeadRow";

/** An item's page in Get more (a catalog plugin, a gallery theme): back to
 *  the list, its head - mark, name, what it is, who made it, its button -
 *  then what the page shows of it. */
export function MarketPage({
  data,
  backLabel,
  onBack,
  mark,
  name,
  description,
  byline,
  action,
  children,
}: {
  /** The page's data-* attributes, by which tests and themes find it. */
  data: Record<`data-${string}`, string>;
  backLabel: string;
  /** None in a tab of its own. */
  onBack?: () => void;
  mark?: ReactNode;
  name: string;
  description?: string;
  byline: ReactNode;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="plugin-page market-plugin-page" {...data}>
      {onBack && (
        <button type="button" className="plugin-back" onClick={onBack}>
          ‹ {backLabel}
        </button>
      )}
      <HeadRow
        className="market-plugin-head"
        mark={mark}
        tools={action}
        title={
          <div className="market-plugin-title">
            <h2 className="plugin-page-title">{name}</h2>
            {description && (
              <div className="settings-row-hint">{description}</div>
            )}
            {byline}
          </div>
        }
      />
      {children}
    </div>
  );
}
