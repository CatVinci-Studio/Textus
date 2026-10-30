import { useEffect, useState } from "react";
import type { Strings } from "../../i18n/strings";
import { ai, plugins as pluginsIpc } from "../../platform/ipc";
import type { CatalogState, SkillEntry } from "../../plugins/store/catalog";
import { errorText } from "../../utils/error-text";
import { useSettings } from "../../prefs/SettingsContext";
import type { TextKey } from "../../i18n/strings";
import { AvailableSection } from "../pages/AvailableSection";
import { SKILLS_CHANGED_EVENT, announceChange } from "./skills";

/** The error the backend gives for a skill of that name the user already has. */
const SKILL_EXISTS = "SKILL_EXISTS";

/** The catalog's skills whose name, description, author or names in any
 *  language hold every word of `query`. */
export function searchSkills(list: SkillEntry[], query: string): SkillEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((s) => {
    const names = Object.values(s.labels ?? {}).flatMap((l) => [
      l.label,
      l.hint,
    ]);
    const text = [s.name, s.description, s.author, ...names]
      .join("\n")
      .toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

const MODE_LABEL = {
  write: "agentModeWrite",
  review: "agentModeReview",
  create: "agentModeCreate",
} as const satisfies Record<string, TextKey>;

/** Under the user's skills: the catalog's skills not installed yet, each
 *  installed with a click into the global skills folder. */
export function AvailableSkills({
  t,
  catalog,
  query,
}: {
  t: Strings;
  catalog: CatalogState;
  query: string;
}) {
  const [have, setHave] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { settings } = useSettings();
  useEffect(() => {
    let live = true;
    const load = () =>
      void ai
        .listSkills(null, null)
        .then((list) => {
          if (live && Array.isArray(list))
            setHave(new Set(list.map((s) => s.name.toLowerCase())));
        })
        .catch(() => live && setHave(new Set()));
    load();
    window.addEventListener(SKILLS_CHANGED_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(SKILLS_CHANGED_EVENT, load);
    };
  }, []);
  const ready = catalog.status === "ready" && have !== null;
  const shown = ready
    ? searchSkills(catalog.skills, query).filter(
        (s) => !have.has(s.name.toLowerCase()),
      )
    : [];
  const install = async (skill: SkillEntry) => {
    setBusy(skill.name);
    setError(null);
    try {
      await pluginsIpc.installSkillFromCatalog(skill.name);
    } catch (err) {
      if (errorText(err) !== SKILL_EXISTS)
        setError(`${t.marketSkillFailed} ${errorText(err)}`);
    } finally {
      setBusy(null);
    }
    announceChange();
  };
  const message = !ready ? (
    <p className="plugin-empty">{t.pluginsCatalogLoading}</p>
  ) : !catalog.skills.length ? (
    <p className="plugin-empty">{t.marketSkillsNone}</p>
  ) : query.trim() && !shown.length ? (
    <p className="plugin-empty">
      {t.pluginsSearchNone.replace("{query}", query.trim())}
    </p>
  ) : undefined;
  return (
    <AvailableSection
      t={t}
      kind="skills"
      searching={!!query.trim()}
      message={message}
      note={
        error && (
          <div className="settings-error" role="alert">
            {error}
          </div>
        )
      }
      rows={shown.map((skill) => {
        const words =
          skill.labels?.[settings.language] ?? skill.labels?.en ?? null;
        return (
          <div
            key={skill.name}
            className="settings-row plugin-card"
            data-skill={skill.name}
          >
            <div className="plugin-card-open">
              <span className="settings-row-label plugin-card-name">
                {words?.label ?? `/${skill.name}`}
              </span>
              <span className="settings-row-hint plugin-card-description">
                {words ? `/${skill.name} · ${words.hint}` : skill.description}
              </span>
              {(skill.official || skill.author) && (
                <span className="plugin-byline">
                  <span className="market-skill-modes">
                    {(skill.modes ?? ["write"])
                      .map((m) => t[MODE_LABEL[m]])
                      .join(" · ")}
                  </span>
                  {skill.official && (
                    <span className="plugin-official">{t.pluginOfficial}</span>
                  )}
                  {skill.author &&
                    t.themeGalleryBy.replace("{author}", skill.author)}
                </span>
              )}
            </div>
            <div className="settings-row-control">
              <button
                type="button"
                className="plugin-install"
                disabled={busy === skill.name}
                onClick={() => void install(skill)}
              >
                {busy === skill.name ? t.pluginInstalling : t.pluginInstall}
              </button>
            </div>
          </div>
        );
      })}
    />
  );
}
