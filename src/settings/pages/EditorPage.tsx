import { isMobileApp } from "../../platform/capabilities";
import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import {
  type ContentWidth,
  type EmbedDisplay,
  type ImageAlign,
  type ColorSwatchMode,
  type DiagramEngine,
} from "../../prefs/SettingsContext";
import {
  PDF_TEXT_SCALES,
  type FormatBarSide,
  type PdfMargin,
  type PdfPaper,
  type PdfTextScale,
  type SingleTildeMode,
  type ViewMode,
} from "../../prefs/settings-values";
import { AdvancedFold, SettingRow, ToggleRow } from "../sections/controls";
import { DocTextFold } from "../sections/text-font";
import { ImageStorageSection } from "../sections/images";
import { ExportFileRow } from "../sections/export-files";
import { PandocArgsRows } from "../sections/pandoc-args";
import { Select } from "../../engine/controls/Select";
import { canExportPdf, canExportWithPandoc } from "../../platform/capabilities";
import { isMacPlatform } from "../../platform/os";

/** Editing › Text: how the text is set, and the view a document opens in. */
export function EditTextPage({ t, settings, setSettings }: SettingsPageProps) {
  return (
    <>
      {/* How the text is set. */}
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
        <ToggleRow
          label={t.firstLineIndentLabel}
          checked={settings.firstLineIndent}
          onChange={(v) => setSettings({ firstLineIndent: v })}
        />
        <ToggleRow
          label={t.emptyLineHintLabel}
          checked={settings.emptyLineHint}
          onChange={(v) => setSettings({ emptyLineHint: v })}
        />
        <ToggleRow
          label={t.blockHandlesLabel}
          help={t.blockHandlesHelp}
          checked={settings.blockHandles}
          onChange={(v) => setSettings({ blockHandles: v })}
        />
        {!isMobileApp && (
          <ToggleRow
            label={t.smoothCaretLabel}
            checked={settings.smoothCaret}
            onChange={(v) => setSettings({ smoothCaret: v })}
          />
        )}
        <DocTextFold t={t} settings={settings} setSettings={setSettings} />
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
            <option value="source">{t.menuToggleSourceMode}</option>
            <option value="split">{t.menuToggleSplitView}</option>
          </Select>
        </SettingRow>
        <SettingRow label={t.menuFormatBar}>
          <Select
            className="settings-select"
            aria-label={t.menuFormatBar}
            value={settings.formatBar ? settings.formatBarSide : "hidden"}
            onChange={(e) => {
              const side = e.target.value;
              setSettings(
                side === "hidden"
                  ? { formatBar: false }
                  : { formatBar: true, formatBarSide: side as FormatBarSide },
              );
            }}
          >
            <option value="top">{t.menuFormatBarTop}</option>
            <option value="left">{t.menuFormatBarLeft}</option>
            <option value="right">{t.menuFormatBarRight}</option>
            <option value="hidden">{t.menuFormatBarHidden}</option>
          </Select>
        </SettingRow>
        <ToggleRow
          label={t.zoomTogetherLabel}
          help={t.zoomTogetherHint}
          checked={settings.zoomTogether}
          onChange={(on) => setSettings({ zoomTogether: on })}
        />
        <ToggleRow
          label={t.menuToggleTypewriterMode}
          checked={settings.typewriterMode}
          onChange={(v) => setSettings({ typewriterMode: v })}
        />
      </SettingsGroup>
    </>
  );
}

/** Editing › Markdown: what the document shows and how typing behaves; diagrams, colour swatches, the ** and ` pairs under Advanced. */
export function EditMarkdownPage({
  t,
  settings,
  setSettings,
}: SettingsPageProps) {
  return (
    <>
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
        <SettingRow label={t.singleTildeLabel}>
          <Select
            className="settings-select"
            aria-label={t.singleTildeLabel}
            value={settings.singleTilde}
            onChange={(e) =>
              setSettings({ singleTilde: e.target.value as SingleTildeMode })
            }
          >
            <option value="subscript">{t.singleTildeSubscript}</option>
            <option value="strikethrough">{t.singleTildeStrikethrough}</option>
            <option value="text">{t.singleTildeText}</option>
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

/** Editing › Images: how a picture on its own line sits, and where pasted images go. */
export function EditImagesPage({
  t,
  settings,
  setSettings,
  docPath = null,
}: SettingsPageProps) {
  return (
    <>
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
    </>
  );
}

/** Editing › Export: PDF and Word, Pandoc's arguments under Advanced. */
export function EditExportPage({
  t,
  settings,
  setSettings,
}: SettingsPageProps) {
  return (
    <>
      {/* No PDF export on the phone, so no group there either. */}
      {canExportPdf && (
        <SettingsGroup title={t.menuExport}>
          <ToggleRow
            label={t.pdfPageNumbersLabel}
            checked={settings.pdfPageNumbers}
            onChange={(v) => setSettings({ pdfPageNumbers: v })}
          />
          <SettingRow label={t.pdfPaperLabel}>
            <Select
              className="settings-select"
              aria-label={t.pdfPaperLabel}
              value={settings.pdfPaper}
              onChange={(e) =>
                setSettings({ pdfPaper: e.target.value as PdfPaper })
              }
            >
              <option value="a4">A4</option>
              <option value="letter">Letter</option>
              <option value="a5">A5</option>
            </Select>
          </SettingRow>
          <SettingRow label={t.pdfMarginLabel}>
            <Select
              className="settings-select"
              aria-label={t.pdfMarginLabel}
              value={settings.pdfMargin}
              onChange={(e) =>
                setSettings({ pdfMargin: e.target.value as PdfMargin })
              }
            >
              <option value="narrow">{t.pdfMarginNarrow}</option>
              <option value="normal">{t.pdfMarginNormal}</option>
              <option value="wide">{t.pdfMarginWide}</option>
            </Select>
          </SettingRow>
          <SettingRow label={t.pdfTextScaleLabel}>
            <Select
              className="settings-select"
              aria-label={t.pdfTextScaleLabel}
              value={String(settings.pdfTextScale)}
              onChange={(e) =>
                setSettings({
                  pdfTextScale: Number(e.target.value) as PdfTextScale,
                })
              }
            >
              {PDF_TEXT_SCALES.map((scale) => (
                <option key={scale} value={scale}>
                  {Math.round(scale * 100)}%
                </option>
              ))}
            </Select>
          </SettingRow>
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
      {canExportWithPandoc && (
        <AdvancedFold t={t}>
          <PandocArgsRows t={t} />
        </AdvancedFold>
      )}
    </>
  );
}
