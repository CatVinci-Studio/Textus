import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import {
  type ContentWidth,
  type ImageAlign,
  UI_TEXT_SCALES,
  type UiTextScale,
  type ColorSwatchMode,
  type DiagramEngine,
} from "../../prefs/SettingsContext";
import { AdvancedFold, SettingRow, ToggleRow } from "../sections/controls";
import { useSyncExternalStore } from "react";
import {
  subscribeTracking,
  trackingShown,
} from "../../ai/margin/track-changes-state";
import {
  readOnlyShown,
  subscribeReadOnly,
} from "../../document/read-only-state";
import { emitMenuEvent } from "../../platform/menu-events";
import { ThemeSection } from "../sections/theme";
import { ImageStorageSection } from "../sections/images";
import { Select } from "../../ui/Select";
import { appDrawsWindowFrame } from "../../platform/window-chrome";
import { canExportPdf, isIOSApp } from "../../platform/capabilities";
import { isMacPlatform } from "../../platform/os";
import { openExtensionsTab } from "./extensions-tab";

/** Editor & Appearance: the theme, the window's layout and view modes, and how Markdown is typed and shown. */
export function EditorPage({
  t,
  settings,
  setSettings,
  phone,
  percent,
  setSubpage,
  openPage,
}: SettingsPageProps) {
  const tracking = useSyncExternalStore(subscribeTracking, trackingShown);
  const readOnly = useSyncExternalStore(subscribeReadOnly, readOnlyShown);
  return (
    <>
      <SettingsGroup title={t.navTheme}>
        <ThemeSection
          t={t}
          onMore={() => {
            // The phone has no Extensions page: its themes are a page of
            // their own here.
            if (isIOSApp) return setSubpage("themes");
            openExtensionsTab("themes");
            openPage("extensions");
          }}
        />
      </SettingsGroup>
      {/* The window's layout, then the view every document is in. */}
      <SettingsGroup title={t.settingsViewGroup}>
        <SettingRow label={t.contentWidthLabel}>
          <Select
            className="settings-select"
            aria-label={t.contentWidthLabel}
            value={settings.contentWidth}
            onChange={(e) =>
              setSettings({
                contentWidth: e.target.value as ContentWidth,
              })
            }
          >
            <option value="auto">{t.contentWidthAuto}</option>
            <option value="standard">{t.contentWidthStandard}</option>
            <option value="full">{t.contentWidthFull}</option>
          </Select>
        </SettingRow>
        {/* A phone's UI is sized by iOS's own text styles instead. */}
        {!phone && (
          <SettingRow label={t.uiTextScaleLabel}>
            <Select
              className="settings-select"
              aria-label={t.uiTextScaleLabel}
              value={String(settings.uiTextScale)}
              onChange={(e) =>
                setSettings({
                  uiTextScale: Number(e.target.value) as UiTextScale,
                })
              }
            >
              {UI_TEXT_SCALES.map((scale) => (
                <option key={scale} value={String(scale)}>
                  {percent.format(scale)}
                </option>
              ))}
            </Select>
          </SettingRow>
        )}
        {appDrawsWindowFrame && (
          <ToggleRow
            label={t.menuBarLabel}
            help={t.menuBarHelp}
            checked={settings.menuBarShown}
            onChange={(on) => setSettings({ menuBarShown: on })}
          />
        )}
        {/* One view for every document in every window. */}
        <ToggleRow
          label={t.menuViewSource}
          checked={settings.viewMode === "source"}
          onChange={(on) => setSettings({ viewMode: on ? "source" : "rich" })}
        />
        <ToggleRow
          label={t.menuToggleSplitView}
          checked={settings.viewMode === "split"}
          onChange={(on) => setSettings({ viewMode: on ? "split" : "rich" })}
        />
        <ToggleRow
          label={t.menuViewTypewriter}
          checked={settings.typewriterMode}
          onChange={(v) => setSettings({ typewriterMode: v })}
        />
        <ToggleRow
          label={t.menuToggleZenMode}
          checked={settings.zenMode}
          onChange={(on) => setSettings({ zenMode: on })}
        />
        {/* The document in front's, as the View menu's own. */}
        <ToggleRow
          label={t.menuTrackChanges}
          hint={t.settingsFrontDocumentHint}
          checked={tracking}
          onChange={() => emitMenuEvent("track-changes")}
        />
        <ToggleRow
          label={t.menuToggleReadOnly}
          hint={t.settingsFrontDocumentHint}
          checked={readOnly}
          onChange={() => emitMenuEvent("toggle-read-only")}
        />
      </SettingsGroup>
      {/* What the document shows, then how typing behaves. */}
      <SettingsGroup title={t.navMarkdown}>
        <ToggleRow
          label={t.enableMathLabel}
          checked={settings.enableMath}
          onChange={(v) => setSettings({ enableMath: v })}
        />
        <ToggleRow
          label={t.enableMermaidLabel}
          checked={settings.enableMermaid}
          onChange={(v) => setSettings({ enableMermaid: v })}
        />
        <ToggleRow
          label={t.codeLineNumbersLabel}
          checked={settings.codeLineNumbers}
          onChange={(v) => setSettings({ codeLineNumbers: v })}
        />
        <ToggleRow
          label={t.autoCloseBracketsLabel}
          checked={settings.autoCloseBrackets}
          onChange={(v) => setSettings({ autoCloseBrackets: v })}
        />
      </SettingsGroup>
      <SettingsGroup title={t.imageStorageGroupLabel}>
        <SettingRow label={t.imageAlignLabel}>
          <Select
            className="settings-select"
            aria-label={t.imageAlignLabel}
            value={settings.imageAlign}
            onChange={(e) =>
              setSettings({ imageAlign: e.target.value as ImageAlign })
            }
          >
            <option value="center">{t.imageAlignCenter}</option>
            <option value="left">{t.imageAlignLeft}</option>
          </Select>
        </SettingRow>
        <ImageStorageSection t={t} />
      </SettingsGroup>
      {/* No PDF export on the phone, so no group there either. */}
      {canExportPdf && (
        <SettingsGroup title={t.menuExport}>
          <ToggleRow
            label={t.pdfPageNumbersLabel}
            checked={settings.pdfPageNumbers}
            onChange={(v) => setSettings({ pdfPageNumbers: v })}
          />
          {isMacPlatform() && (
            <ToggleRow
              label={t.pdfLightColorsLabel}
              checked={settings.pdfLightColors}
              onChange={(v) => setSettings({ pdfLightColors: v })}
            />
          )}
        </SettingsGroup>
      )}
      {/* Rarely changed: how diagrams are drawn, colour swatches, and the
       ** and ` pairs. */}
      <AdvancedFold t={t}>
        {settings.enableMermaid && (
          <SettingRow label={t.diagramEngineLabel} help={t.diagramEngineHint}>
            <Select
              className="settings-select"
              aria-label={t.diagramEngineLabel}
              value={settings.diagramEngine}
              onChange={(e) =>
                setSettings({
                  diagramEngine: e.target.value as DiagramEngine,
                })
              }
            >
              <option value="mermaid">{t.diagramEngineMermaid}</option>
              <option value="pele">{t.diagramEnginePele}</option>
            </Select>
          </SettingRow>
        )}
        <SettingRow label={t.colorSwatchesLabel}>
          <Select
            className="settings-select"
            aria-label={t.colorSwatchesLabel}
            value={settings.colorSwatches}
            onChange={(e) =>
              setSettings({
                colorSwatches: e.target.value as ColorSwatchMode,
              })
            }
          >
            <option value="off">{t.colorSwatchesOff}</option>
            <option value="code">{t.colorSwatchesCode}</option>
            <option value="everywhere">{t.colorSwatchesEverywhere}</option>
          </Select>
        </SettingRow>
        <ToggleRow
          label={t.autoCloseMarksLabel}
          checked={settings.autoCloseMarks}
          onChange={(v) => setSettings({ autoCloseMarks: v })}
        />
      </AdvancedFold>
    </>
  );
}
