import { TutorialExperience } from "../onboarding/TutorialExperience";
import { LanguageWelcome } from "../onboarding/LanguageWelcome";
import type { Tutorial } from "../onboarding/useTutorial";
import type { Settings } from "../settings/SettingsContext";
import { formatCombo } from "../utils/shortcuts";
import { Presence } from "../ui/usePresence";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import type { Strings } from "../i18n/strings";

/** The first-run layers over the window: the onboarding tour, and before
 *  it the language welcome. */
export function OnboardingLayers({
  tutorial,
  settings,
  setSettings,
  zen,
  t,
}: {
  tutorial: Tutorial;
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  zen: { on: boolean; toggle: () => void };
  t: Strings;
}) {
  const phone = usePhoneLayout();
  return (
    <>
      {tutorial.active && settings.languageChosen && (
        <TutorialExperience
          tutorial={tutorial}
          t={t}
          language={settings.language}
          phone={phone}
          shortcuts={{
            agentPanel: formatCombo(settings.shortcuts.toggleAgentPanel),
            sidebar: formatCombo(settings.shortcuts.toggleSidebar),
          }}
          zen={zen}
        />
      )}
      <Presence show={!settings.languageChosen} exitMs={200}>
        {!settings.languageChosen && (
          <LanguageWelcome
            language={settings.language}
            onLanguage={(language) => setSettings({ language })}
            onContinue={() => setSettings({ languageChosen: true })}
          />
        )}
      </Presence>
    </>
  );
}
