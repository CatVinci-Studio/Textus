import { useEffect, useId, useState } from "react";
import { announce } from "../ui/announce";
import { CloseIcon } from "../ui/icons";
import { Tooltip } from "../ui/Tooltip";
import { Presence, PresenceDiv } from "../ui/usePresence";
import { usePluginCard } from "../plugins/store/usePluginCard";
import { pluginName, pluginText } from "../plugins/store/plugin-records";
import { PluginIcon } from "../settings/pages/PluginArt";
import type { CardRequest } from "../plugins/store/plugin-card";
import type { Strings } from "../i18n/strings";

/** The Install button's words for what the card is about. */
function installLabel(request: CardRequest, t: Strings): string {
  const open = request.situation.type === "open";
  if (request.installed)
    return open ? t.pluginOpenTurnOnButton : t.pluginTurnOn;
  return open ? t.pluginOpenInstall : t.pluginInstall;
}

/** The one bottom-right card that suggests an official plugin: "Plugin
 *  suggestion: <name>", Install, Later and ×; the line opens to the
 *  plugin's description. It never takes the focus and stays until
 *  answered; Install still asks for the permissions. */
export function SuggestCard({ t }: { t: Strings }) {
  const card = usePluginCard();
  const [open, setOpen] = useState(false);
  const moreId = useId();
  const request = card?.request ?? null;
  const item = card?.item ?? null;
  const name = item
    ? pluginName({ id: item.id, manifest: item.manifest })
    : (request?.plugin ?? "");
  const line = t.pluginCardLine.replace("{name}", name);
  useEffect(() => {
    setOpen(false);
    if (request) announce(line);
  }, [request, line]);
  return (
    <Presence show={!!card} exitMs={120}>
      {card && request && (
        <PresenceDiv
          className="update-toast suggest-card"
          role="region"
          aria-label={line}
          data-open={open || undefined}
        >
          <button
            type="button"
            className="suggest-card-summary"
            aria-expanded={open}
            aria-controls={moreId}
            onClick={() => setOpen((v) => !v)}
          >
            <PluginIcon
              id={request.plugin}
              manifest={item?.manifest ?? null}
              url={item?.icon}
            />
            <span className="suggest-card-line">{line}</span>
          </button>
          <div className="suggest-card-actions">
            <button
              type="button"
              className="update-toast-primary"
              onClick={() => card.answer("install")}
            >
              {installLabel(request, t)}
            </button>
            {request.situation.type === "open" && (
              <button
                type="button"
                className="update-toast-secondary"
                onClick={() => card.answer("system")}
              >
                {t.pluginCardSystemApp}
              </button>
            )}
            <button
              type="button"
              className="update-toast-secondary"
              onClick={() => card.answer("later")}
            >
              {t.updateLater}
            </button>
            <Tooltip text={t.pluginCardNever}>
              <button
                type="button"
                className="tx-icon-button suggest-card-never"
                aria-label={t.pluginCardNever}
                onClick={() => card.answer("never")}
              >
                <CloseIcon />
              </button>
            </Tooltip>
          </div>
          {open && item && (
            <p className="suggest-card-more" id={moreId}>
              {pluginText(item, item.manifest.description)}
            </p>
          )}
        </PresenceDiv>
      )}
    </Presence>
  );
}
