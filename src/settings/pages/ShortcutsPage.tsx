import type { SettingsPageProps, ShortcutCommand } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { type HeadingAction, type ShortcutAction } from "../SettingsContext";
import {
  CommandShortcutRow,
  ShortcutRow,
  FixedShortcutList,
  headingLabels,
} from "../sections/shortcut-rows";

/** Shortcuts: the ones that can be changed, by group - the plugins'
 *  commands last among them - then the fixed ones. */
export function ShortcutsPage({
  t,
  settings,
  setSettings,
  fixedShortcuts,
  pluginCommands,
}: SettingsPageProps) {
  const keyOf = (command: ShortcutCommand) =>
    settings.commandShortcuts[command.id] ?? command.shortcut ?? "";
  return (
    <>
      {/* Most used first: finding - in the document, then among the
            folder's file names - and moving between tabs, then the
            panels and modes of the window, then the AI's keys. */}
      {(
        [
          [
            t.shortcutEditorGroupLabel,
            [
              ["commandPalette", t.shortcutCommandPalette],
              ["findReplace", t.shortcutFindReplace],
              ["searchFiles", t.shortcutSearchFiles],
              ["nextTab", t.shortcutNextTab],
              ["previousTab", t.shortcutPreviousTab],
            ],
          ],
          [
            t.settingsViewGroup,
            [
              ["toggleSidebar", t.shortcutToggleSidebar],
              ["toggleAgentPanel", t.shortcutToggleAgentPanel],
              ["toggleSplitView", t.shortcutToggleSplitView],
              ["toggleSourceMode", t.shortcutToggleSourceMode],
              ["toggleTypewriterMode", t.shortcutToggleTypewriterMode],
              ["toggleZenMode", t.shortcutToggleZenMode],
              ["splitEditor", t.shortcutSplitEditor],
            ],
          ],
          [
            t.shortcutAiGroupLabel,
            [
              ["toggleTextusAi", t.shortcutToggleTextusAi],
              ["triggerCompletion", t.shortcutTriggerCompletion],
              ["triggerGrammarCheck", t.shortcutTriggerGrammarCheck],
              ["toggleFloatingChat", t.shortcutToggleFloatingChat],
            ],
          ],
        ] satisfies [string, [ShortcutAction, string][]][]
      ).map(([title, rows]) => (
        <SettingsGroup key={title} title={title}>
          {rows.map(([action, label]) => (
            <ShortcutRow
              key={action}
              label={label}
              action={action}
              shortcuts={settings.shortcuts}
              setSettings={setSettings}
              t={t}
              fixed={fixedShortcuts}
            />
          ))}
        </SettingsGroup>
      ))}
      <SettingsGroup title={t.shortcutHeadingsGroupLabel}>
        {Object.entries(headingLabels(t)).map(([action, label]) => (
          <ShortcutRow
            key={action}
            label={label}
            action={action as HeadingAction}
            shortcuts={settings.shortcuts}
            setSettings={setSettings}
            t={t}
            fixed={fixedShortcuts}
          />
        ))}
      </SettingsGroup>
      {pluginCommands.length > 0 && (
        <SettingsGroup title={t.menuPlugins}>
          {pluginCommands.map((command) => (
            <CommandShortcutRow
              key={command.id}
              label={command.title}
              command={command.id}
              fallback={command.shortcut}
              overrides={settings.commandShortcuts}
              setOverrides={(commandShortcuts) =>
                setSettings({ commandShortcuts })
              }
              others={pluginCommands
                .filter((other) => other.id !== command.id && keyOf(other))
                .map((other) => ({ label: other.title, combo: keyOf(other) }))}
              shortcuts={settings.shortcuts}
              t={t}
              fixed={fixedShortcuts}
            />
          ))}
        </SettingsGroup>
      )}
      {fixedShortcuts.length > 0 && (
        <SettingsGroup title={t.shortcutFixedGroupLabel}>
          <FixedShortcutList groups={fixedShortcuts} />
        </SettingsGroup>
      )}
    </>
  );
}
