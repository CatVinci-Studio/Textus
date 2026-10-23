import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { type HeadingAction, type ShortcutAction } from "../SettingsContext";
import {
  ShortcutRow,
  FixedShortcutList,
  headingLabels,
} from "../sections/controls";

/** Shortcuts: the ones that can be changed, by group, then the fixed ones. */
export function ShortcutsPage({
  t,
  settings,
  setSettings,
  fixedShortcuts,
}: SettingsPageProps) {
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
      {fixedShortcuts.length > 0 && (
        <SettingsGroup title={t.shortcutFixedGroupLabel}>
          <FixedShortcutList groups={fixedShortcuts} />
        </SettingsGroup>
      )}
    </>
  );
}
