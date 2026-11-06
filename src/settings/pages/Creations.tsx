import { useEffect, useState, useSyncExternalStore } from "react";
import "./creations.css";
import { ai, themes } from "../../platform/ipc";
import { useSettings } from "../../prefs/SettingsContext";
import type {
  Creation,
  CreationKind,
  Settings,
} from "../../prefs/settings-types";
import type { Strings } from "../../i18n/strings";
import {
  creationRows,
  withoutCreation,
  type CreationRow,
  type SkillState,
} from "../../ai/chat/creations";
import {
  pluginsSnapshot,
  setPluginEnabled,
  subscribePlugins,
  uninstallPlugin,
} from "../../plugins/manager";
import { showConfirm } from "../../ui/app-dialog";
import { useLatest } from "../../utils/hooks/useLatest";
import { explainError } from "../../utils/error-explain";
import { announceChange, SKILLS_CHANGED_EVENT } from "../sections/skills";
import type { ExtensionsTab } from "./extensions-tab";

type Skill = SkillState & { prompt?: string };

const TAB: Record<CreationKind, ExtensionsTab> = {
  plugin: "plugins",
  theme: "themes",
  skill: "skills",
};

/**
 * Create's "Made here": every plugin, theme and skill a reply's card
 * installed, in one list however each is stored - turned on or off (a
 * theme: used), opened in its own tab, changed with Textus AI or removed,
 * one or all. Under the starting points while nothing is being made, and
 * a menu in the bar while something is.
 */
export function Creations({
  t,
  kindLabel,
  inBar,
  onOpenTab,
  onEdit,
}: {
  t: Strings;
  kindLabel: Record<CreationKind, string>;
  inBar: boolean;
  onOpenTab: (tab: ExtensionsTab) => void;
  /** Starts a conversation of `kind` from `text`. */
  onEdit: (kind: CreationKind, text: string) => void;
}) {
  const { settings, setSettings } = useSettings();
  const latest = useLatest(settings);
  const plugins = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () =>
      void ai
        .listSkills(null, null)
        .then((list) => setSkills(Array.isArray(list) ? list : []))
        .catch(() => setSkills([]));
    load();
    window.addEventListener(SKILLS_CHANGED_EVENT, load);
    return () => window.removeEventListener(SKILLS_CHANGED_EVENT, load);
  }, []);

  const rows = creationRows(settings.creations, {
    plugins: plugins.records,
    userThemes: settings.userThemes,
    themeId: settings.themeId,
    skills,
  });
  if (rows.length === 0) return null;

  const act = (work: () => Promise<void>) => {
    setError(null);
    work().catch((err: unknown) => setError(explainError(err, t)));
  };
  async function remove(gone: Creation[]) {
    const ask =
      gone.length === 1
        ? t.createdRemoveAsk.replace("{name}", gone[0].name)
        : t.createdRemoveAllAsk.replace("{count}", String(gone.length));
    const yes = await showConfirm(ask, {
      okLabel: t.createdRemove,
      cancelLabel: t.cancel,
      danger: true,
    });
    if (!yes) return;
    const done: Creation[] = [];
    try {
      for (const c of gone) {
        await removeOne(c);
        done.push(c);
      }
    } finally {
      setSettings(withoutRemoved(latest.current, done));
    }
  }

  const list = (
    <div className="creations" aria-label={t.createdTitle} role="group">
      <div className="creations-head">
        <span className="creations-title">{t.createdTitle}</span>
        {rows.length > 1 && (
          <button
            type="button"
            className="text-button settings-inline-button"
            onClick={() => act(() => remove(rows.map((r) => r.creation)))}
          >
            {t.createdRemoveAll}
          </button>
        )}
      </div>
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
      <ul className="creations-list">
        {rows.map((row) => (
          <CreationItem
            key={`${row.creation.kind}:${row.creation.id}`}
            t={t}
            row={row}
            kind={kindLabel[row.creation.kind]}
            onToggle={() =>
              act(() => toggle(row, (patch) => setSettings(patch)))
            }
            onOpen={() => onOpenTab(TAB[row.creation.kind])}
            onEdit={
              settings.textusAi
                ? () =>
                    act(async () => {
                      const text = await editRequest(row.creation, t, skills);
                      setOpen(false);
                      onEdit(row.creation.kind, text);
                    })
                : undefined
            }
            onRemove={() => act(() => remove([row.creation]))}
          />
        ))}
      </ul>
    </div>
  );
  if (!inBar) return list;
  return (
    <span className="creations-menu">
      <button
        type="button"
        className="text-button settings-inline-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t.createdMenu.replace("{count}", String(rows.length))}
      </button>
      {open && <div className="creations-popover">{list}</div>}
    </span>
  );
}

function CreationItem({
  t,
  row,
  kind,
  onToggle,
  onOpen,
  onEdit,
  onRemove,
}: {
  t: Strings;
  row: CreationRow;
  kind: string;
  onToggle: () => void;
  onOpen: () => void;
  /** Absent while Textus AI is off. */
  onEdit?: () => void;
  onRemove: () => void;
}) {
  const { creation, state } = row;
  const status =
    state.kind === "plugin"
      ? state.problem
        ? t.createdBroken
        : state.on
          ? t.createdOn
          : t.createdOff
      : state.kind === "theme"
        ? state.inUse
          ? t.createdInUse
          : null
        : state.kind === "skill"
          ? state.off
            ? t.createdOff
            : t.createdOn
          : null;
  const toggleLabel =
    state.kind === "theme"
      ? state.inUse
        ? null
        : t.createdUse
      : state.kind === "plugin"
        ? state.on
          ? t.createdTurnOff
          : t.createdTurnOn
        : state.kind === "skill"
          ? state.off
            ? t.createdTurnOn
            : t.createdTurnOff
          : null;
  return (
    <li className="creations-item" data-creation={creation.kind}>
      <span className="creations-kind">{kind}</span>
      <span className="creations-name">{creation.name}</span>
      {status && <span className="creations-status">{status}</span>}
      <span className="creations-actions">
        {toggleLabel && (
          <button type="button" onClick={onToggle}>
            {toggleLabel}
          </button>
        )}
        <button type="button" onClick={onOpen}>
          {t.createdOpen}
        </button>
        {onEdit && (
          <button type="button" onClick={onEdit}>
            {t.createdEdit}
          </button>
        )}
        <button type="button" onClick={onRemove}>
          {t.createdRemove}
        </button>
      </span>
    </li>
  );
}

/** The settings without what `done` removed: its entries, and a theme's
 *  record (the one in use goes back to the default). */
function withoutRemoved(
  now: Settings,
  done: Creation[],
): Pick<Settings, "creations" | "userThemes" | "themeId"> {
  let { creations, userThemes, themeId } = now;
  for (const c of done) {
    creations = withoutCreation(creations, c.kind, c.id);
    if (c.kind !== "theme") continue;
    userThemes = userThemes.filter((th) => th.id !== c.id);
    if (themeId === c.id) themeId = "default";
  }
  return { creations, userThemes, themeId };
}

/** What to ask Create to change a made thing: a plugin by its id, as its
 *  page's Edit with AI does; a theme and a skill with what they say now, as
 *  the model can't read them itself. */
async function editRequest(
  creation: Creation,
  t: Strings,
  skills: Skill[] | null,
): Promise<string> {
  if (creation.kind === "plugin")
    return t.pluginEditWithAiAsk
      .replace("{name}", creation.name)
      .replace("{id}", creation.id);
  const source =
    creation.kind === "theme"
      ? ((await themes.loadThemeCss(creation.id, "light")) ?? "")
      : (skills?.find((s) => s.name === creation.id)?.prompt ?? "");
  return (creation.kind === "theme" ? t.createdEditTheme : t.createdEditSkill)
    .replace("{name}", creation.name)
    .replace("{source}", source.trim());
}

/** Turns a made plugin or skill on or off; uses a made theme. */
async function toggle(
  { creation, state }: CreationRow,
  setSettings: (patch: { themeId: string }) => void,
): Promise<void> {
  if (state.kind === "plugin") await setPluginEnabled(creation.id, !state.on);
  else if (state.kind === "theme") setSettings({ themeId: creation.id });
  else if (state.kind === "skill") {
    await ai.setSkillOff(creation.id, "global", null, null, !state.off);
    announceChange();
  }
}

/** Removes a made thing from its own store. */
async function removeOne(creation: Creation): Promise<void> {
  if (creation.kind === "plugin") await uninstallPlugin(creation.id);
  else if (creation.kind === "theme") await themes.deleteTheme(creation.id);
  else {
    await ai.deleteGlobalSkill(creation.id);
    announceChange();
  }
}
