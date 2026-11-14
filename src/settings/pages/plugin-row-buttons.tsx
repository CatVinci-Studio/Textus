import { DownloadIcon, RefreshIcon } from "../../engine/controls/icons";
import { Tooltip } from "../../engine/controls/Tooltip";
import { fill } from "../../i18n/fill";
import type { Strings } from "../../i18n/strings";
import { neededTextus, type CatalogItem } from "../../plugins/store/catalog";
import { pluginName } from "../../plugins/store/plugin-records";

/** Install, or - for a plugin this Textus is too old for - a button that
 *  can't be pressed and says which Textus it needs. */
export function AvailableButton({
  t,
  item,
  installing,
  onInstall,
}: {
  t: Strings;
  item: CatalogItem;
  installing: string | null;
  onInstall: () => void;
}) {
  const needs = neededTextus(item);
  const name = pluginName({ id: item.id, manifest: item.manifest });
  if (needs) {
    const why = fill(t.pluginNeedsTextus, { version: needs });
    return (
      <RowButton
        label={`${why} · ${name}`}
        tip={why}
        unavailable
        onClick={() => {}}
      />
    );
  }
  return (
    <RowButton
      label={`${t.pluginInstall} · ${name}`}
      tip={installing === item.id ? t.pluginInstalling : t.pluginInstall}
      disabled={installing !== null}
      onClick={onInstall}
    />
  );
}

/** A row's one action, as a small round button: the words keep the row.
 *  An update turns, in the accent: something to do, not something to get. */
export function RowButton({
  label,
  tip,
  update = false,
  disabled = false,
  unavailable = false,
  onClick,
}: {
  label: string;
  tip: string;
  update?: boolean;
  disabled?: boolean;
  /** Can't be pressed, but still shows its tooltip on hover. */
  unavailable?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip text={tip}>
      <button
        type="button"
        className="tree-tool plugins-panel-action"
        data-update={update || undefined}
        aria-label={label}
        disabled={disabled}
        aria-disabled={unavailable || undefined}
        onClick={unavailable ? undefined : onClick}
      >
        {update ? <RefreshIcon /> : <DownloadIcon />}
      </button>
    </Tooltip>
  );
}
