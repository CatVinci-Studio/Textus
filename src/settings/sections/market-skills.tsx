import { useEffect, useState } from "react";
import type { Strings } from "../../i18n/strings";
import { ai, plugins as pluginsIpc } from "../../platform/ipc";
import type { CatalogState, SkillEntry } from "../../plugins/store/catalog";
import { errorText } from "../../utils/error-text";
import { useSettings } from "../SettingsContext";
import type { TextKey } from "../../i18n/strings";

/** The error skill_install_catalog answers for a skill of that name the
 *  user has already (plugins/catalog.rs). */
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

/** What the UI calls each mode. */
const MODE_LABEL = {
  write: "agentModeWrite",
  review: "agentModeReview",
  create: "agentModeCreate",
} as const satisfies Record<string, TextKey>;

/**
 * The market's skills (Settings › Extensions › Get more): the skill
 * files textus-plugins' catalog lists, each installed into the global
 * skills folder - and so in the `/` menu of every document - with a
 * click. One the user has already (by name) says so instead.
 */
export function MarketSkills({
  t,
  catalog,
  query,
}: {
  t: Strings;
  catalog: CatalogState;
  query: string;
}) {
  const [have, setHave] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { settings } = useSettings();
  useEffect(() => {
    let live = true;
    void ai
      .listSkills(null, null)
      .then((list) => {
        if (live && Array.isArray(list))
          setHave(new Set(list.map((s) => s.name.toLowerCase())));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (catalog.status !== "ready")
    return <p className="plugin-empty">{t.pluginsCatalogLoading}</p>;
  const shown = searchSkills(catalog.skills, query);
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
    setHave((prev) => new Set(prev).add(skill.name.toLowerCase()));
  };
  return (
    <>
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
      <div className="settings-group-body">
        {shown.length ? (
          shown.map((skill) => {
            const installed = have.has(skill.name.toLowerCase());
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
                    {words
                      ? `/${skill.name} · ${words.hint}`
                      : skill.description}
                  </span>
                  {(skill.official || skill.author) && (
                    <span className="plugin-byline">
                      <span className="market-skill-modes">
                        {(skill.modes ?? ["write"])
                          .map((m) => t[MODE_LABEL[m]])
                          .join(" · ")}
                      </span>
                      {skill.official && (
                        <span className="plugin-official">
                          {t.pluginOfficial}
                        </span>
                      )}
                      {skill.author &&
                        t.themeGalleryBy.replace("{author}", skill.author)}
                    </span>
                  )}
                </div>
                <div className="settings-row-control">
                  {installed ? (
                    <span className="settings-row-value">
                      {t.marketSkillInstalled}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="plugin-install"
                      disabled={busy === skill.name}
                      onClick={() => void install(skill)}
                    >
                      {busy === skill.name
                        ? t.pluginInstalling
                        : t.pluginInstall}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <p className="plugin-empty">
            {catalog.skills.length
              ? t.pluginsSearchNone.replace("{query}", query.trim())
              : t.marketSkillsNone}
          </p>
        )}
      </div>
    </>
  );
}
