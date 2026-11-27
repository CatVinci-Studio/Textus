import { useEffect, useState } from "react";
import type { Strings } from "../../i18n/strings";
import { ai } from "../../platform/ipc";
import { isMobileApp } from "../../platform/capabilities";
import { useSettings } from "../../prefs/SettingsContext";
import { getUiState, setUiState } from "../../storage/ui-state";
import { CloseIcon } from "../../engine/controls/icons";

/** Magpie's gateway (usemagpie.ai), the provider id it has in the catalog. */
const MAGPIE = "magpie";

/**
 * Settings › AI: Magpie found running on this computer while the AI uses
 * another service - one tap makes it Textus's, its pooled plans and keys
 * with it. Asked once: put away, it stays away.
 */
export function MagpieNote({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const [found, setFound] = useState(false);
  const [away, setAway] = useState(
    () => getUiState("magpieNoteDismissed") === true,
  );
  const inUse = settings.aiProvider === MAGPIE;
  useEffect(() => {
    if (isMobileApp || inUse || away) return;
    let live = true;
    ai.fetchAgentModels(MAGPIE).then(
      (models) => live && setFound(models.length > 0),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [inUse, away]);
  if (!found || inUse || away) return null;
  return (
    <div className="settings-row magpie-note" role="note">
      <span>{t.magpieFound}</span>
      <span className="magpie-note-actions">
        <button
          type="button"
          className="tx-button text-button settings-inline-button"
          onClick={() => setSettings({ aiProvider: MAGPIE })}
        >
          {t.magpieUse}
        </button>
        <button
          type="button"
          className="tx-icon-button"
          aria-label={t.magpieDismiss}
          onClick={() => {
            setUiState("magpieNoteDismissed", true);
            setAway(true);
          }}
        >
          <CloseIcon />
        </button>
      </span>
    </div>
  );
}
