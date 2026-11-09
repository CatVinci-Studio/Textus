import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import {
  type ContentWidth,
  type EmbedDisplay,
  type ImageAlign,
  UI_TEXT_SCALES,
  type UiTextScale,
  type ColorSwatchMode,
  type DiagramEngine,
  type Settings,
} from "../../prefs/SettingsContext";
import type { ViewMode } from "../../prefs/settings-values";
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
import { DocTextFold } from "../sections/text-font";
import { ImageStorageSection } from "../sections/images";
import { ExportFileRow } from "../sections/export-files";
import { PandocArgsRows } from "../sections/pandoc-args";
import { Select } from "../../ui/Select";
import { appDrawsWindowFrame } from "../../platform/window-chrome";
import { canExportPdf, canExportWithPandoc } from "../../platform/capabilities";
import { isMacPlatform } from "../../platform/os";
import { openExtensionsTab } from "./extensions-tab";

/** Editor & Appearance: the theme, the window's layout and view modes, and how Markdown is typed and shown. */
export function EditorPage({
  t,
  settings,
  setSettings,
  phone,
  percent,
  openPage,
  docPath = null,
}: SettingsPageProps) {
  const tracking = useSyncExternalStore(subscribeTracking, trackingShown);
  const readOnly = useSyncExternalStore(subscribeReadOnly, readOnlyShown);
  return (
    <>
      <SettingsGroup title={t.navTheme}>
        <ThemeSection
          t={t}
          onMore={() => {
            openExtensionsTab("themes");
            openPage("extensions");
          }}
        />
      </SettingsGroup>
      {/* How the text is set, and the window's own. */}
      <SettingsGroup title={t.settingsTextGroup}>
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
        <DocTextFold t={t} settings={settings} setSettings={setSettings} />
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
        {!phone && (
          <SettingRow label={t.layoutLabel}>
            <Select
              className="settings-select"
              aria-label={t.layoutLabel}
              value={settings.layout}
              onChange={(e) =>
                setSettings({
                  layout: e.target.value as Settings["layout"],
                })
              }
            >
              <option value="islands">{t.layoutIslands}</option>
              <option value="classic">{t.layoutClassic}</option>
            </Select>
          </SettingRow>
        )}
        <ToggleRow
          label={t.activityRailLabel}
          help={t.activityRailHelp}
          checked={settings.activityRail}
          onChange={(on) => setSettings({ activityRail: on })}
        />
        {appDrawsWindowFrame && (
          <ToggleRow
            label={t.menuBarLabel}
            help={t.menuBarHelp}
            checked={settings.menuBarShown}
            onChange={(on) => setSettings({ menuBarShown: on })}
          />
        )}
      </SettingsGroup>
      {/* One view for every document in every window. */}
      <SettingsGroup title={t.settingsViewGroup}>
        <SettingRow label={t.viewModeLabel} help={t.viewModeHelp}>
          <Select
            className="settings-select"
            aria-label={t.viewModeLabel}
            value={settings.viewMode}
            onChange={(e) =>
              setSettings({ viewMode: e.target.value as ViewMode })
            }
          >
            <option value="rich">{t.viewModeRich}</option>
            <option value="source">{t.menuViewSource}</option>
            <option value="split">{t.menuToggleSplitView}</option>
          </Select>
        </SettingRow>
        <ToggleRow
          label={t.menuFormatBar}
          checked={settings.formatBar}
          onChange={(on) => setSettings({ formatBar: on })}
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
      </SettingsGroup>
      {/* The document in front's, as the View menu's own. */}
      <SettingsGroup title={t.settingsDocumentGroup}>
        <ToggleRow
          label={t.menuTrackChanges}
          checked={tracking}
          onChange={() => emitMenuEvent("track-changes")}
        />
        <ToggleRow
          label={t.menuToggleReadOnly}
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
        <ToggleRow
          label={t.plainTextMenuLabel}
          checked={settings.plainTextMenu}
          onChange={(v) => setSettings({ plainTextMenu: v })}
        />
        <SettingRow label={t.embedDisplayLabel}>
          <Select
            className="settings-select"
            aria-label={t.embedDisplayLabel}
            value={settings.embedDisplay}
            onChange={(e) =>
              setSettings({ embedDisplay: e.target.value as EmbedDisplay })
            }
          >
            <option value="expand">{t.embedDisplayExpand}</option>
            <option value="card">{t.embedDisplayCard}</option>
          </Select>
        </SettingRow>
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
        <ImageStorageSection t={t} docPath={docPath} />
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
          {canExportWithPandoc && (
            <>
              <ExportFileRow t={t} setting="docxReferenceDoc" />
              <ToggleRow
                label={t.exportTocLabel}
                checked={settings.exportToc}
                onChange={(v) => setSettings({ exportToc: v })}
              />
              <ToggleRow
                label={t.exportNumberHeadingsLabel}
                help={t.exportNumberHeadingsHelp}
                checked={settings.exportNumberHeadings}
                onChange={(v) => setSettings({ exportNumberHeadings: v })}
              />
              <ExportFileRow t={t} setting="exportBibliography" />
              {settings.exportBibliography && (
                <ExportFileRow t={t} setting="exportCsl" />
              )}
            </>
          )}
        </SettingsGroup>
      )}
      {/* Rarely changed: the frosted title bar, how diagrams are drawn,
      colour swatches, and the ** and ` pairs. */}
      <AdvancedFold t={t}>
        <ToggleRow
          label={t.frostedTitleBarLabel}
          help={t.frostedTitleBarHelp}
          checked={!settings.solidTitleBar}
          onChange={(on) => setSettings({ solidTitleBar: !on })}
        />
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
        {canExportWithPandoc && <PandocArgsRows t={t} />}
      </AdvancedFold>
    </>
  );
}
