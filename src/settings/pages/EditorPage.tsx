import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import {
  type ContentWidth,
  UI_TEXT_SCALES,
  type UiTextScale,
  type ColorSwatchMode,
  type DiagramEngine,
} from "../SettingsContext";
import { SettingRow, ToggleRow } from "../sections/controls";
import { ThemeSection } from "../sections/theme";
import { ImageStorageSection } from "../sections/images";
import { Select } from "../../ui/Select";
import { emitMenuEvent } from "../../platform/menu-events";
import { appDrawsWindowFrame } from "../../platform/window-chrome";
import { canExportPdf } from "../../platform/capabilities";

/** Editor & Appearance: the theme, the window's layout and view modes, and how Markdown is typed and shown. */
export function EditorPage({
  t,
  settings,
  setSettings,
  phone,
  percent,
  setSubpage,
  viewChecks,
}: SettingsPageProps) {
  return (
    <>
      <SettingsGroup title={t.navTheme}>
        <ThemeSection t={t} onMore={() => setSubpage("themes")} />
      </SettingsGroup>
      {/* How the window lays out - the text's width and the interface's
            size - then the window's view modes, beside the one that is a
            setting (typewriter): on a phone, whose menu is kept short,
            this is where they are switched. Each mode goes through the
            same event as its menu item, so the two never disagree. */}
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
        <ToggleRow
          label={t.menuViewSource}
          checked={!!viewChecks.sourceMode}
          onChange={() => emitMenuEvent("toggle-source-mode")}
        />
        <ToggleRow
          label={t.menuViewTypewriter}
          checked={settings.typewriterMode}
          onChange={(v) => setSettings({ typewriterMode: v })}
        />
        <ToggleRow
          label={t.menuToggleZenMode}
          checked={!!viewChecks.zen}
          onChange={() => emitMenuEvent("toggle-zen-mode")}
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
        <ToggleRow
          label={t.codeLineNumbersLabel}
          checked={settings.codeLineNumbers}
          onChange={(v) => setSettings({ codeLineNumbers: v })}
        />
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
        <ToggleRow
          label={t.autoCloseBracketsLabel}
          checked={settings.autoCloseBrackets}
          onChange={(v) => setSettings({ autoCloseBrackets: v })}
        />
      </SettingsGroup>
      <SettingsGroup title={t.imageStorageGroupLabel}>
        <ImageStorageSection t={t} />
      </SettingsGroup>
      {/* What a PDF export looks like. No PDF export on the phone
            (canExportPdf), so no group there either. */}
      {canExportPdf && (
        <SettingsGroup title={t.menuExport}>
          <ToggleRow
            label={t.pdfPageNumbersLabel}
            checked={settings.pdfPageNumbers}
            onChange={(v) => setSettings({ pdfPageNumbers: v })}
          />
        </SettingsGroup>
      )}
    </>
  );
}
