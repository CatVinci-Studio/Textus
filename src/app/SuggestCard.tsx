import { useEffect, useId, useState } from "react";
import { announce } from "../ui/announce";
import { CloseIcon } from "../ui/icons";
import { Tooltip } from "../ui/Tooltip";
import { Presence, PresenceDiv } from "../ui/usePresence";
import { usePluginCard } from "../plugins/store/usePluginCard";
import { pluginName, pluginText } from "../plugins/store/plugin-records";
import { permissionLabel } from "../plugins/store/permissions";
import { installsText } from "../settings/pages/installs-text";
import { Byline } from "../settings/pages/PluginPage";
import { PluginIcon } from "../settings/pages/PluginArt";
import type { CardRequest } from "../plugins/store/plugin-card";
import type { Strings } from "../i18n/strings";

/** The card's one line: a plugin's own reason says who asks and which
 *  plugin; the app's reasons already name both. */
function cardLine(request: CardRequest, name: string, t: Strings): string {
  const s = request.situation;
  return s.type === "offer"
    ? t.pluginCardOfferLine
        .replace("{caller}", s.caller.name)
        .replace("{name}", name)
        .replace("{reason}", request.reason)
    : request.reason;
}

/** The Install button's words for what the card is about. */
function installLabel(request: CardRequest, t: Strings): string {
  const open = request.situation.type === "open";
  if (request.installed)
    return open ? t.pluginOpenTurnOnButton : t.pluginTurnOn;
  return open ? t.pluginOpenInstall : t.pluginInstall;
}

/** The one bottom-right card that suggests an official plugin: a line that
 *  opens to say more, and Install, Later and ×. It never takes the focus
 *  and stays until answered. */
export function SuggestCard({ t }: { t: Strings }) {
  const card = usePluginCard();
  const [open, setOpen] = useState(false);
  const moreId = useId();
  const request = card?.request ?? null;
  const name = request
    ? card?.item
      ? pluginName({ id: card.item.id, manifest: card.item.manifest })
      : request.plugin
    : "";
  useEffect(() => {
    setOpen(false);
    if (request) announce(cardLine(request, name, t));
  }, [request, name, t]);
  const item = card?.item ?? null;
  const installs = item ? installsText(item, t) : null;
  return (
    <Presence show={!!card} exitMs={120}>
      {card && request && (
        <PresenceDiv
          className="update-toast suggest-card"
          role="region"
          aria-label={name}
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
            <span className="suggest-card-line">
              {cardLine(request, name, t)}
            </span>
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
          {open && (
            <div className="suggest-card-more" id={moreId}>
              <strong className="suggest-card-name">{name}</strong>
              {item && (
                <>
                  <p>{pluginText(item, item.manifest.description)}</p>
                  <Byline
                    manifest={item.manifest}
                    official={item.official}
                    t={t}
                  >
                    {installs && (
                      <span className="plugin-installs">{installs}</span>
                    )}
                  </Byline>
                  <div className="suggest-card-permissions">
                    <strong>{t.pluginPermissionsLabel}</strong>
                    {item.manifest.permissions.length ? (
                      <ul>
                        {item.manifest.permissions.map((p) => (
                          <li key={p}>{permissionLabel(p, t)}</li>
                        ))}
                      </ul>
                    ) : (
                      t.pluginNoPermissions
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </PresenceDiv>
      )}
    </Presence>
  );
}
