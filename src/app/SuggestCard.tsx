import { fill } from "../i18n/fill";
import { useEffect } from "react";
import { announce } from "../engine/controls/announce";
import { CornerToast } from "../engine/controls/CornerToast";
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

/** The corner card that suggests an official plugin: "Plugin suggestion:
 *  <name>", Install, Later and ×; the line opens to the plugin's
 *  description. Install still asks for the permissions. */
export function SuggestCard({ t }: { t: Strings }) {
  const card = usePluginCard();
  const request = card?.request ?? null;
  const item = card?.item ?? null;
  const name = item
    ? pluginName({ id: item.id, manifest: item.manifest })
    : (request?.plugin ?? "");
  const line = fill(
    request?.situation.type === "moved"
      ? t.pluginCardMovedLine
      : t.pluginCardLine,
    { name },
  );
  useEffect(() => {
    if (request) announce(line);
  }, [request, line]);
  const answer = card?.answer ?? (() => {});
  return (
    <CornerToast
      show={!!request}
      name="suggest-card"
      label={line}
      icon={
        request && (
          <PluginIcon
            id={request.plugin}
            manifest={item?.manifest ?? null}
            url={item?.icon}
          />
        )
      }
      line={line}
      details={item && pluginText(item, item.manifest.description)}
      actions={
        request
          ? [
              {
                label: installLabel(request, t),
                onSelect: () => answer("install"),
                primary: true,
              },
              ...(request.situation.type === "open"
                ? [
                    {
                      label: t.pluginCardSystemApp,
                      onSelect: () => answer("system"),
                    },
                  ]
                : []),
              { label: t.updateLater, onSelect: () => answer("later") },
            ]
          : []
      }
      close={{ label: t.pluginCardNever, onSelect: () => answer("never") }}
    />
  );
}
