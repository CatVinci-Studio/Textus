import { useEffect, useReducer, useState } from "react";
import { SettingRow, ToggleRow, VERBATIM_INPUT } from "../sections/controls";
import { Select } from "../../ui/Select";
import type { Strings } from "../../i18n/strings";
import {
  pluginSetting,
  pluginText,
  runPluginCommand,
  setPluginSetting,
  type PluginRecord,
} from "../../plugins/manager";
import {
  globalPluginValue,
  onPluginSettingsChange,
  pluginValue,
  projectRoot,
  settingShown,
  type SettingScope,
} from "../../plugins/store/plugin-settings";
import { basename } from "../../utils/path";
import type { SettingContribution } from "../../plugins/store/manifest";

/**
 * A plugin's settings from its manifest, drawn like Textus's own: for
 * every document, or - a folder open - for this project alone, over those
 * (plugin-settings.ts).
 */
export function PluginSettingRows({
  record,
  t,
}: {
  record: PluginRecord;
  t: Strings;
}) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onPluginSettingsChange(redraw), []);
  const root = projectRoot();
  const [scope, setScope] = useState<SettingScope>("global");
  const where: SettingScope = root ? scope : "global";
  return (
    <>
      {root && (
        <SettingRow label={t.pluginSettingsScope}>
          <Select
            className="settings-select"
            aria-label={t.pluginSettingsScope}
            value={where}
            onChange={(e) => setScope(e.target.value as SettingScope)}
          >
            <option value="global">{t.pluginSettingsScopeGlobal}</option>
            <option value="project">
              {t.pluginSettingsScopeProject.replace("{name}", basename(root))}
            </option>
          </Select>
        </SettingRow>
      )}
      {shownSettings(record).map(({ setting, heading }) => (
        <div key={setting.key} className="plugin-setting">
          {heading && (
            <h4 className="plugin-setting-group">
              {pluginText(record, heading)}
            </h4>
          )}
          <PluginSettingRow
            record={record}
            setting={setting}
            scope={where}
            t={t}
          />
        </div>
      ))}
    </>
  );
}

/** The settings that show now (their `when`), each with the heading to
 *  put over it: its group's, where a new group starts. */
function shownSettings(
  record: PluginRecord,
): { setting: SettingContribution; heading?: string }[] {
  let group: string | undefined;
  return record
    .manifest!.contributes.settings.filter((setting) =>
      settingShown(setting.when, (key) => pluginSetting(record.id, key)),
    )
    .map((setting) => {
      const heading =
        setting.group && setting.group !== group ? setting.group : undefined;
      group = setting.group ?? group;
      return { setting, heading };
    });
}

/** One setting, as `scope` holds it: the project's shows its own value or
 *  the general one under it; the general one says when the project has its
 *  own. */
function PluginSettingRow({
  record,
  setting,
  scope,
  t,
}: {
  record: PluginRecord;
  setting: SettingContribution;
  scope: SettingScope;
  t: Strings;
}) {
  const held = pluginValue(record.id, setting.key);
  const value =
    scope === "project" || held.from !== "project"
      ? pluginSetting(record.id, setting.key)
      : generalValue(record, setting);
  const label = pluginText(record, setting.title);
  const own = held.from === "project";
  const description = setting.description
    ? pluginText(record, setting.description)
    : undefined;
  const help =
    scope === "global" && own
      ? [description, t.pluginSettingProjectOwn].filter(Boolean).join(" ")
      : description;
  const save = (next: unknown) =>
    void setPluginSetting(record.id, setting.key, next, scope);
  const reset =
    scope === "project" && own ? (
      <button
        type="button"
        onClick={() =>
          void setPluginSetting(record.id, setting.key, undefined, "project")
        }
      >
        {t.pluginSettingUseGeneral}
      </button>
    ) : null;
  if (setting.type === "button")
    return (
      <SettingRow label={label} help={description}>
        <button
          type="button"
          className="text-button settings-inline-button"
          onClick={() => void runPluginCommand(record.id, setting.command!, [])}
        >
          {label}
        </button>
      </SettingRow>
    );
  if (setting.type === "boolean")
    return (
      <>
        <ToggleRow
          label={label}
          help={help}
          checked={value === true}
          onChange={save}
        />
        {reset && <div className="plugin-setting-reset">{reset}</div>}
      </>
    );
  if (setting.multiline || setting.type === "list")
    return (
      <div className="plugin-setting-lines">
        <SettingRow label={label} help={help}>
          {reset}
        </SettingRow>
        <textarea
          // A new layer's value, a new field (as below).
          key={`${scope}:${JSON.stringify(value ?? "")}`}
          className="settings-text-input plugin-setting-textarea"
          aria-label={label}
          rows={5}
          defaultValue={
            Array.isArray(value) ? value.join("\n") : String(value ?? "")
          }
          {...VERBATIM_INPUT}
          onBlur={(e) =>
            save(
              setting.type === "list"
                ? e.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                : e.target.value,
            )
          }
        />
      </div>
    );
  return (
    <SettingRow label={label} help={help}>
      {setting.type === "enum" ? (
        <Select
          className="settings-select"
          aria-label={label}
          value={String(value)}
          onChange={(e) => save(e.target.value)}
        >
          {setting.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {pluginText(record, option.label)}
            </option>
          ))}
        </Select>
      ) : setting.type === "color" ? (
        <input
          className="plugin-setting-color"
          aria-label={label}
          type="color"
          value={String(value ?? "#000000")}
          onChange={(e) => save(e.target.value)}
        />
      ) : (
        <input
          // A new layer's value, a new field: the old one's text is not
          // this one's.
          key={`${scope}:${String(value ?? "")}`}
          className="settings-text-input plugin-setting-input"
          aria-label={label}
          type={setting.type === "number" ? "number" : "text"}
          min={setting.min}
          max={setting.max}
          defaultValue={String(value ?? "")}
          {...VERBATIM_INPUT}
          onBlur={(e) =>
            save(
              setting.type === "number"
                ? clamp(Number(e.target.value), setting)
                : e.target.value,
            )
          }
        />
      )}
      {reset}
    </SettingRow>
  );
}

/** A number typed, kept within the setting's min and max. */
function clamp(n: number, setting: SettingContribution): number {
  const low = setting.min ?? -Infinity;
  const high = setting.max ?? Infinity;
  const typed = Number.isFinite(n) ? n : Number(setting.default ?? 0);
  return Math.min(high, Math.max(low, typed));
}

/** The value for every document, the project's aside. */
function generalValue(record: PluginRecord, setting: SettingContribution) {
  const value = globalPluginValue(record.id, setting.key);
  return value === undefined ? (setting.default ?? null) : value;
}
