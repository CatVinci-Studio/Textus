import { AboutSection } from "./sections/about";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  useSettings,
  COMPLETION_TONES,
  type CompletionTone,
  type AgentMode,
  type GrammarStrictness,
  type NewDocumentMode,
  type ContentWidth,
  type ProxyType,
  REVISION_DISPLAYS,
  type RevisionDisplay,
  type HeadingAction,
  type ShortcutAction,
  UI_TEXT_SCALES,
  type UiTextScale,
  type DiagramEngine,
} from "./SettingsContext";
import {
  marginViewBlocked,
  revisionDisplayName,
} from "../ai/revision/revision-display";
import { useMarginAvailable } from "../ai/margin/margin-room";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import {
  LANGS,
  LANG_NAMES,
  localeOf,
  type Lang,
  type TextKey,
} from "../i18n/strings";
import {
  LinkRow,
  SettingRow,
  ToggleRow,
  ShortcutRow,
  FixedShortcutList,
  headingLabels,
  VERBATIM_INPUT,
} from "./sections/controls";
import type { FixedShortcutGroup } from "../app/fixed-shortcuts";
import { ChevronIcon, CloseIcon } from "../ui/icons";
import { CliCommandSection, DefaultEditorSection } from "./sections/general";
import { links } from "../platform/ipc";
import { ThemeSection } from "./sections/theme";
import { ThemeGallerySection } from "./sections/theme-gallery";
import { ProviderListPanel } from "./sections/providers";
import {
  AgentModelSection,
  ModelListRow,
  WritingModelSection,
  AgentWorkspaceRootSection,
  AgentWorkspaceSection,
  AgentSystemPromptSection,
} from "./sections/agent";
import {
  AgentSkillsSection,
  BuiltinSkillsSection,
  WritingConventionsRow,
} from "./sections/skills";
import { PrivacySection } from "./sections/privacy";
import { ImageStorageSection } from "./sections/images";
import { BackgroundSection } from "./sections/background";
import "./SettingsPanel.css";
import { useModalDialog } from "../ui/useModalDialog";
import { usePresenceProps } from "../ui/usePresence";
import { Select } from "../ui/Select";
import { emitMenuEvent } from "../platform/menu-events";
import type { MenuChecks } from "../app/app-menu-model";
import {
  canDetachChat,
  canExportPdf,
  canInstallCliCommand,
  canPickFolder,
  canRevealInFileManager,
  canSetDefaultEditor,
  canUseWindows,
  isIOSApp,
} from "../platform/capabilities";

// The settings dialog shell: category nav + the per-category rows. Anything
// with its own state or backend round-trips lives in sections/ - this file
// only composes them and renders the plain settings.* rows inline.
//
// One panel for every platform. Each row is a name and a control
// (SettingRow); explanations are kept to the few rows that need one. On a
// phone the same panel fills the screen with the categories as a row of
// tabs along the top (mobile/styles/settings.css) - layout only, no second
// set of pages to keep in step.

interface SettingsPanelProps {
  onClose: () => void;
  /** Opens a document in the editor - the agent.md "edit" button uses it. */
  onOpenFile: (path: string) => void;
  /** Files a settings action deleted (Reset on a customized skill), for
   *  the editor to close their tabs. */
  onFilesDeleted?: (paths: string[]) => void;
  /** Which of the window's view modes are on, for Editor > View. */
  viewChecks?: Pick<MenuChecks, "sourceMode" | "zen">;
  /** The shortcuts that can't be changed, listed under the ones that can
   *  (built from the app menu, app/fixed-shortcuts.ts). */
  fixedShortcuts?: FixedShortcutGroup[];
}

export type Category = "general" | "editor" | "ai" | "shortcuts" | "privacy";

type Subpage = "about" | "themes";

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-group">
      <h2 className="settings-group-title">{title}</h2>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}

export function SettingsPanel({
  onClose,
  onOpenFile,
  onFilesDeleted,
  viewChecks = {},
  fixedShortcuts = [],
}: SettingsPanelProps) {
  const { settings, setSettings, t } = useSettings();
  // As in the review bar: a phone never has a margin, so there is nothing
  // to explain there.
  const marginAvailable = useMarginAvailable();
  const phone = usePhoneLayout();
  const noMargin = !phone && !marginAvailable;
  // "125 %" in French, "125%" in English.
  const percent = new Intl.NumberFormat(localeOf(settings.language), {
    style: "percent",
  });
  const [category, setCategory] = useState<Category>("general");
  // A page of its own inside a category, with a way back, on the desktop
  // and the phone alike: General › About Textus, Editor & Appearance ›
  // Browse themes.
  const [subpage, setSubpage] = useState<Subpage | null>(null);
  // Closing Settings on a phone leaves the keyboard down: the user is
  // going back to the page, not necessarily to typing.
  const modal = useModalDialog(onClose, true, undefined, false);
  // Rendered inside a Presence (App.tsx): it goes the way it came.
  const presence = usePresenceProps<HTMLDivElement>();

  // The guides open as documents, behind this panel - so it gives way.
  const openHelp = (doc: "markdown" | "agent") => {
    onClose();
    emitMenuEvent(`help-doc:${doc}`);
  };

  const categories: { id: Category; label: string }[] = [
    { id: "general", label: t.navGeneral },
    { id: "editor", label: t.navEditor },
    { id: "ai", label: t.navAi },
    // A phone has no keyboard to bind shortcuts on.
    ...(isIOSApp ? [] : [{ id: "shortcuts" as const, label: t.navShortcuts }]),
    { id: "privacy", label: t.navPrivacy },
  ];

  const renderCategory = (c: Category) => (
    <>
      {c === "general" && (
        <>
          <SettingsGroup title={t.generalBasicsLabel}>
            <SettingRow label={t.languageLabel}>
              <Select
                className="settings-select"
                aria-label={t.languageLabel}
                value={settings.language}
                onChange={(e) =>
                  setSettings({ language: e.target.value as Lang })
                }
              >
                {/* Each in its own language, so a user who can't read the
                    current one still finds theirs. */}
                {LANGS.map((lang) => (
                  <option key={lang} value={lang}>
                    {LANG_NAMES[lang]}
                  </option>
                ))}
              </Select>
            </SettingRow>
            {canUseWindows && (
              <>
                <SettingRow label={t.newDocumentModeLabel}>
                  <Select
                    className="settings-select"
                    aria-label={t.newDocumentModeLabel}
                    value={settings.newDocumentMode}
                    onChange={(e) =>
                      setSettings({
                        newDocumentMode: e.target.value as NewDocumentMode,
                      })
                    }
                  >
                    <option value="window">{t.newDocumentModeWindow}</option>
                    <option value="tab">{t.newDocumentModeTab}</option>
                  </Select>
                </SettingRow>
                <ToggleRow
                  label={t.restoreSessionLabel}
                  checked={settings.restoreSessionOnStartup}
                  onChange={(v) => setSettings({ restoreSessionOnStartup: v })}
                />
              </>
            )}
          </SettingsGroup>

          {/* How documents reach the disk - used daily, so above the rarer
              groups. */}
          <SettingsGroup title={t.settingsFilesGroup}>
            <ToggleRow
              label={t.autosaveLabel}
              checked={settings.autosave}
              onChange={(v) => setSettings({ autosave: v })}
            />
            <ToggleRow
              label={t.autoSuggestFilenameLabel}
              checked={settings.autoSuggestFilename}
              onChange={(v) => setSettings({ autoSuggestFilename: v })}
            />
          </SettingsGroup>

          <SettingsGroup title={t.generalSystemLabel}>
            {/* A desktop's: the phone has no windows to close. */}
            {canUseWindows && <BackgroundSection t={t} />}
            {canSetDefaultEditor && <DefaultEditorSection t={t} />}
            {canInstallCliCommand && <CliCommandSection t={t} />}
            <LinkRow label={t.aboutTextus} onOpen={() => setSubpage("about")} />
          </SettingsGroup>

          {/* Last: links out rather than settings. The desktop also has
              them in the Help menu; a phone's menu is kept short, so there
              this is where they are. */}
          <SettingsGroup title={t.settingsHelpGroup}>
            <LinkRow
              label={t.menuHelpMarkdown}
              onOpen={() => openHelp("markdown")}
            />
            <LinkRow label={t.menuHelpAgent} onOpen={() => openHelp("agent")} />
            <LinkRow
              label={t.menuHelpTutorials}
              onOpen={() => void links.openTutorialsPage(settings.language)}
            />
            <LinkRow
              label={t.menuHelpCommunity}
              onOpen={() => void links.openCommunityPage(settings.language)}
            />
          </SettingsGroup>
        </>
      )}

      {c === "editor" && (
        <>
          <SettingsGroup title={t.navTheme}>
            <ThemeSection t={t} onBrowse={() => setSubpage("themes")} />
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
              <SettingRow
                label={t.diagramEngineLabel}
                help={t.diagramEngineHint}
              >
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
            <ToggleRow
              label={t.inlineColorSwatchesLabel}
              checked={settings.inlineColorSwatches}
              onChange={(v) => setSettings({ inlineColorSwatches: v })}
            />
            <ToggleRow
              label={t.autoCloseMarksLabel}
              checked={settings.autoCloseMarks}
              onChange={(v) => setSettings({ autoCloseMarks: v })}
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
      )}

      {/* One page for the AI, connect first and then the features, each
          model beside the feature it drives. The model list is fetched
          once, under Connection, for both pickers. */}
      {c === "ai" && (
        <>
          <SettingsGroup title={t.aiAccountLabel}>
            <ProviderListPanel t={t} />
            <SettingRow label={t.proxyLabel}>
              <Select
                className="settings-select"
                aria-label={t.proxyLabel}
                value={settings.proxyType}
                onChange={(e) =>
                  setSettings({ proxyType: e.target.value as ProxyType })
                }
              >
                <option value="none">{t.proxyTypeNone}</option>
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="socks5">SOCKS5</option>
              </Select>
            </SettingRow>
            {settings.proxyType !== "none" && (
              <div className="settings-proxy-row">
                <input
                  type="text"
                  inputMode="url"
                  {...VERBATIM_INPUT}
                  className="settings-text-input settings-proxy-host"
                  placeholder={t.proxyHostPlaceholder}
                  aria-label={t.proxyHostPlaceholder}
                  value={settings.proxyHost}
                  onChange={(e) => setSettings({ proxyHost: e.target.value })}
                />
                <input
                  type="text"
                  inputMode="numeric"
                  {...VERBATIM_INPUT}
                  className="settings-text-input settings-proxy-port"
                  placeholder={t.proxyPortPlaceholder}
                  aria-label={t.proxyPortPlaceholder}
                  value={settings.proxyPort}
                  onChange={(e) => setSettings({ proxyPort: e.target.value })}
                />
              </div>
            )}
            <ModelListRow t={t} />
          </SettingsGroup>

          <SettingsGroup title={t.writingFeaturesLabel}>
            <WritingModelSection t={t} />
            <ToggleRow
              label={t.aiCompletionLabel}
              checked={settings.enableCompletion}
              onChange={(v) => setSettings({ enableCompletion: v })}
            />
            {settings.enableCompletion && (
              <SettingRow label={t.completionToneLabel}>
                <Select
                  className="settings-select"
                  aria-label={t.completionToneLabel}
                  value={settings.completionTone}
                  onChange={(e) =>
                    setSettings({
                      completionTone: e.target.value as CompletionTone,
                    })
                  }
                >
                  {COMPLETION_TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {t[`completionTone_${tone}` as TextKey]}
                    </option>
                  ))}
                </Select>
              </SettingRow>
            )}
            <ToggleRow
              label={t.aiGrammarLabel}
              checked={settings.enableGrammarCheck}
              onChange={(v) => setSettings({ enableGrammarCheck: v })}
            />
            {settings.enableGrammarCheck && (
              <SettingRow label={t.grammarStrictnessLabel}>
                <Select
                  className="settings-select"
                  aria-label={t.grammarStrictnessLabel}
                  value={settings.grammarStrictness}
                  onChange={(e) =>
                    setSettings({
                      grammarStrictness: e.target.value as GrammarStrictness,
                    })
                  }
                >
                  <option value="typos">{t.grammarStrictnessTypos}</option>
                  <option value="standard">
                    {t.grammarStrictnessStandard}
                  </option>
                  <option value="strict">{t.grammarStrictnessStrict}</option>
                </Select>
              </SettingRow>
            )}
            <WritingConventionsRow t={t} />
          </SettingsGroup>

          <SettingsGroup title={t.aiAskLabel}>
            <ToggleRow
              label={t.aiAskToggleLabel}
              checked={settings.enableAskAi}
              onChange={(v) => setSettings({ enableAskAi: v })}
            />
            {settings.enableAskAi && (
              <>
                <AgentModelSection t={t} />
                <SettingRow label={t.agentDefaultModeLabel}>
                  <Select
                    className="settings-select"
                    aria-label={t.agentDefaultModeLabel}
                    value={settings.agentDefaultMode}
                    onChange={(e) =>
                      setSettings({
                        agentDefaultMode: e.target.value as AgentMode,
                      })
                    }
                  >
                    <option value="write">{t.agentModeWrite}</option>
                    <option value="review">{t.agentModeReview}</option>
                    <option value="revise">{t.agentModeRevise}</option>
                  </Select>
                </SettingRow>
                <SettingRow
                  label={t.revisionDisplayLabel}
                  hint={noMargin ? t.revisionDisplayNoRoom : undefined}
                >
                  <Select
                    className="settings-select"
                    aria-label={t.revisionDisplayLabel}
                    value={settings.revisionDisplay}
                    onChange={(e) =>
                      setSettings({
                        revisionDisplay: e.target.value as RevisionDisplay,
                      })
                    }
                  >
                    {REVISION_DISPLAYS.map((mode) => (
                      <option
                        key={mode}
                        value={mode}
                        disabled={marginViewBlocked(mode, {
                          phone,
                          marginAvailable,
                        })}
                      >
                        {revisionDisplayName(t, mode)}
                      </option>
                    ))}
                  </Select>
                </SettingRow>
                <ToggleRow
                  label={t.webSearchLabel}
                  checked={settings.enableWebSearch}
                  onChange={(v) => setSettings({ enableWebSearch: v })}
                />
              </>
            )}
          </SettingsGroup>

          {/* Project files, writing instructions and skills only reach
              conversations, so with chat off there is nothing here to set.
              (Completion still follows the project's style profile and
              library - see docs/design/ai-concepts.md.) */}
          {settings.enableAskAi && (
            <>
              <SettingsGroup title={t.agentPersonalizationGroupLabel}>
                {/* What the AI may read - File › Open Folder… sets it
                    too while the AI has no folder of its own
                    (sidebar/tree-root.ts), so there is one folder setting,
                    not a second one in General. */}
                {canPickFolder && <AgentWorkspaceRootSection t={t} />}
                <ToggleRow
                  label={t.rememberAutomaticallyLabel}
                  help={t.rememberAutomaticallyHint}
                  checked={settings.rememberAutomatically}
                  onChange={(v) => setSettings({ rememberAutomatically: v })}
                />
                <AgentSystemPromptSection
                  t={t}
                  onOpenFile={onOpenFile}
                  onClose={onClose}
                />
                <AgentSkillsSection t={t} />
                {canRevealInFileManager && <AgentWorkspaceSection t={t} />}
              </SettingsGroup>

              <BuiltinSkillsSection
                t={t}
                onOpenFile={onOpenFile}
                onFilesDeleted={onFilesDeleted}
                onClose={onClose}
              />

              <details className="settings-advanced">
                <summary>{t.agentAdvancedGroupLabel}</summary>
                <div className="settings-advanced-body">
                  <ToggleRow
                    label={t.editAnimationLabel}
                    checked={settings.enableEditAnimation}
                    onChange={(v) => setSettings({ enableEditAnimation: v })}
                  />
                  {canDetachChat && (
                    <ToggleRow
                      label={t.agentExpandWindowLabel}
                      checked={settings.agentExpandToWindow}
                      onChange={(v) => setSettings({ agentExpandToWindow: v })}
                    />
                  )}
                </div>
              </details>
            </>
          )}
        </>
      )}

      {c === "privacy" && <PrivacySection t={t} />}

      {c === "shortcuts" && (
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
              />
            ))}
          </SettingsGroup>
          {fixedShortcuts.length > 0 && (
            <SettingsGroup title={t.shortcutFixedGroupLabel}>
              <FixedShortcutList groups={fixedShortcuts} />
            </SettingsGroup>
          )}
        </>
      )}
    </>
  );

  return (
    <div {...presence} className="settings-backdrop" onClick={onClose}>
      <div
        {...modal}
        role="dialog"
        aria-modal="true"
        aria-label={t.settingsTitle}
        className="settings-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <span>{t.settingsTitle}</span>
          {isIOSApp ? (
            // iOS closes a sheet like this with a word, not a cross.
            <button
              className="text-button settings-done-button"
              onClick={onClose}
            >
              {t.settingsDone}
            </button>
          ) : (
            <button
              className="icon-button settings-close-button"
              aria-label={t.windowClose}
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          )}
        </div>

        <div className="settings-layout">
          <nav className="settings-nav">
            {categories.map((c) => (
              <button
                key={c.id}
                aria-current={category === c.id ? "page" : undefined}
                data-label={c.label}
                className={`settings-nav-item ${category === c.id ? "settings-nav-item-active" : ""}`}
                onClick={(e) => {
                  setCategory(c.id);
                  setSubpage(null);
                  // On a phone the tabs are one row that scrolls sideways;
                  // in a long language the chosen one can be half out of
                  // view.
                  e.currentTarget.scrollIntoView?.({
                    block: "nearest",
                    inline: "nearest",
                  });
                }}
              >
                {c.label}
              </button>
            ))}
          </nav>

          {subpage ? (
            <div
              className="settings-content"
              key={subpage}
              role="region"
              aria-label={
                subpage === "about" ? t.navAbout : t.themeGalleryBrowse
              }
            >
              <button
                type="button"
                className="text-button settings-back-button"
                onClick={() => setSubpage(null)}
              >
                <ChevronIcon className="settings-back-chevron" />
                {categories.find((c) => c.id === category)?.label}
              </button>
              {subpage === "about" ? (
                <AboutSection t={t} lang={settings.language} />
              ) : (
                <>
                  <h1 className="settings-category-title">
                    {t.themeGalleryBrowse}
                  </h1>
                  <ThemeGallerySection t={t} />
                </>
              )}
            </div>
          ) : (
            <div
              className="settings-content"
              key={category}
              role="region"
              aria-label={categories.find((c) => c.id === category)?.label}
            >
              <h1 className="settings-category-title">
                {categories.find((c) => c.id === category)?.label}
              </h1>
              {renderCategory(category)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
