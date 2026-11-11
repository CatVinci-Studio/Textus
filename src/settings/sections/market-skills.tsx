import { compareVersions } from "../../plugins/store/manifest";
import { isError } from "../../utils/error-text";
import { Byline, CatalogRow } from "../pages/CatalogRow";
import { explainError } from "../../utils/error-explain";
import { fill } from "../../i18n/fill";
import { useEffect, useState } from "react";
import { MODES } from "../../ai/modes";
import type { Strings } from "../../i18n/strings";
import { ai, plugins as pluginsIpc } from "../../platform/ipc";
import type { CatalogState, SkillEntry } from "../../plugins/store/catalog";
import { useSettings } from "../../prefs/SettingsContext";
import { AvailableSection } from "../pages/AvailableSection";
import { CatalogProblem } from "../pages/AvailablePlugins";
import { installsText } from "../pages/installs-text";
import { SKILLS_CHANGED_EVENT, announceChange } from "./skills";

/** The catalog's skills whose name, description, author or names in any
 *  language hold every word of `query`. */
function searchSkills(list: SkillEntry[], query: string): SkillEntry[] {
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

/** Under the user's skills: the catalog's skills not installed yet, or
 *  installed at an older version (then updated), each a click into the
 *  global skills folder. */
export function AvailableSkills({
  t,
  catalog,
  query,
}: {
  t: Strings;
  catalog: CatalogState;
  query: string;
}) {
  // The user's skills by name: their version when it came from the catalog.
  const [have, setHave] = useState<Map<string, string | null> | null>(null);
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
            setHave(
              new Map(
                list.map((s) => [s.name.toLowerCase(), s.version ?? null]),
              ),
            );
        })
        .catch(() => live && setHave(new Map()));
    load();
    window.addEventListener(SKILLS_CHANGED_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(SKILLS_CHANGED_EVENT, load);
    };
  }, []);
  const ready = catalog.status === "ready" && have !== null;
  /** An older version of it installed: what the button updates. */
  const older = (skill: SkillEntry) => {
    const installed = have?.get(skill.name.toLowerCase());
    return !!installed && compareVersions(skill.version, installed) > 0;
  };
  const shown = ready
    ? searchSkills(catalog.skills, query).filter(
        (s) => !have.has(s.name.toLowerCase()) || older(s),
      )
    : [];
  const install = async (skill: SkillEntry) => {
    setBusy(skill.name);
    setError(null);
    try {
      await pluginsIpc.installSkillFromCatalog(skill.name);
    } catch (err) {
      setError(
        isError(err, "skillExists")
          ? explainError(err, t)
          : `${t.marketSkillFailed} ${explainError(err, t)}`,
      );
    } finally {
      setBusy(null);
    }
    announceChange();
  };
  const message =
    catalog.status === "failed" ? (
      <CatalogProblem
        t={t}
        text={fill(t.pluginsCatalogFailed, {
          reason: explainError(catalog.error, t),
        })}
      />
    ) : !ready ? (
      <p className="tx-list-note">{t.pluginsCatalogLoading}</p>
    ) : !catalog.skills.length ? (
      <p className="tx-list-note">{t.marketSkillsNone}</p>
    ) : query.trim() && !shown.length ? (
      <p className="tx-list-note">
        {fill(t.pluginsSearchNone, { query: query.trim() })}
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
          <CatalogRow
            key={skill.name}
            data-skill={skill.name}
            name={words?.label ?? `/${skill.name}`}
            description={
              words ? `/${skill.name} · ${words.hint}` : skill.description
            }
            byline={
              <Byline
                t={t}
                lead={
                  <span className="market-skill-modes">
                    {(skill.modes ?? ["write"])
                      .map((m) => t[MODES[m].label])
                      .join(" · ")}
                  </span>
                }
                official={skill.official}
                author={skill.author}
                installs={installsText(skill, t)}
              />
            }
            actionClass="plugin-action"
            action={
              <button
                type="button"
                className="text-button plugin-action-main"
                disabled={busy === skill.name}
                onClick={() => void install(skill)}
              >
                {busy === skill.name
                  ? t.pluginInstalling
                  : older(skill)
                    ? fill(t.pluginUpdate, { version: skill.version })
                    : t.pluginInstall}
              </button>
            }
          />
        );
      })}
    />
  );
}
