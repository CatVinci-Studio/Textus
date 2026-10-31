import { Suspense } from "react";
import { lazyModule } from "../lazy/lazy-module";
import { lazyComponent } from "../lazy/lazy-component";
import { LanguageWelcome } from "../onboarding/LanguageWelcome";
import type { Tutorial } from "../onboarding/useTutorial";
import type { Settings } from "../prefs/SettingsContext";
import { formatCombo } from "../utils/shortcuts";
import { Presence } from "../ui/usePresence";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import type { Strings } from "../i18n/strings";

// The tour runs once, on first launch, so it loads only when it starts.
const TutorialExperience = lazyComponent(
  lazyModule("tutorial", () => import("../onboarding/TutorialExperience"), {
    warm: true,
  }),
  (m) => m.TutorialExperience,
);

/** The first-run layers over the window: the onboarding tour, and before
 *  it the language welcome. */
export function OnboardingLayers({
  tutorial,
  settings,
  setSettings,
  t,
}: {
  tutorial: Tutorial;
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  t: Strings;
}) {
  const phone = usePhoneLayout();
  return (
    <>
      {tutorial.active && settings.languageChosen && (
        <Suspense fallback={null}>
          <TutorialExperience
            tutorial={tutorial}
            t={t}
            language={settings.language}
            phone={phone}
            shortcuts={{
              agentPanel: formatCombo(settings.shortcuts.toggleAgentPanel),
              palette: formatCombo(settings.shortcuts.commandPalette),
            }}
          />
        </Suspense>
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
