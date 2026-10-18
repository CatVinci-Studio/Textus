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
  type CopyTextMode,
  type ContentWidth,
  type ProxyType,
  REVISION_DISPLAYS,
  type RevisionDisplay,
} from "./SettingsContext";
import { revisionDisplayName } from "../ai/revision/revision-display";
import { LANGS, LANG_NAMES, type Lang, type TextKey } from "../i18n/strings";
import {
  LinkRow,
  SettingRow,
  ToggleRow,
  ShortcutRow,
  VERBATIM_INPUT,
} from "./sections/controls";
import { ChevronIcon, CloseIcon } from "../ui/icons";
import { CliCommandSection, LevisImportSection } from "./sections/general";
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
}: SettingsPanelProps) {
  const { settings, setSettings, t } = useSettings();
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
            <ToggleRow
              label={t.autoSuggestFilenameLabel}
              checked={settings.autoSuggestFilename}
              onChange={(v) => setSettings({ autoSuggestFilename: v })}
            />
            <ToggleRow
              label={t.autosaveLabel}
              hint={t.autosaveHint}
              checked={settings.autosave}
              onChange={(v) => setSettings({ autosave: v })}
            />
          </SettingsGroup>

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

          <SettingsGroup title={t.generalSystemLabel}>
            {canInstallCliCommand && <CliCommandSection t={t} />}
            <LevisImportSection t={t} lang={settings.language} />
            <LinkRow label={t.aboutTextus} onOpen={() => setSubpage("about")} />
          </SettingsGroup>
        </>
      )}

      {c === "editor" && (
        <>
          <SettingsGroup title={t.navTheme}>
            <ThemeSection t={t} onBrowse={() => setSubpage("themes")} />
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
          </SettingsGroup>
          {/* The window's view modes, beside the one that is a setting
              (typewriter): on a phone, whose menu is kept short, this is
              where they are switched. Each goes through the same event as
              its menu item, so the two never disagree. */}
          <SettingsGroup title={t.settingsViewGroup}>
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
            <SettingRow label={t.copyTextModeLabel} hint={t.copyTextModeHint}>
              <Select
                className="settings-select"
                aria-label={t.copyTextModeLabel}
                value={settings.copyTextMode}
                onChange={(e) =>
                  setSettings({
                    copyTextMode: e.target.value as CopyTextMode,
                  })
                }
              >
                <option value="readable">{t.copyTextModeReadable}</option>
                <option value="markdown">{t.copyTextModeMarkdown}</option>
              </Select>
            </SettingRow>
            {/* No PDF export on the phone (canExportPdf). */}
            {canExportPdf && (
              <ToggleRow
                label={t.pdfPageNumbersLabel}
                hint={t.pdfPageNumbersHint}
                checked={settings.pdfPageNumbers}
                onChange={(v) => setSettings({ pdfPageNumbers: v })}
              />
            )}
          </SettingsGroup>
          <SettingsGroup title={t.imageStorageGroupLabel}>
            <ImageStorageSection t={t} />
          </SettingsGroup>
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
                    <option value="ask">{t.agentModeAsk}</option>
                    <option value="edit">{t.agentModeEdit}</option>
                    <option value="plan">{t.agentModePlan}</option>
                  </Select>
                </SettingRow>
                <SettingRow label={t.revisionDisplayLabel}>
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
                      <option key={mode} value={mode}>
                        {revisionDisplayName(t, mode)}
                      </option>
                    ))}
                  </Select>
                </SettingRow>
                <ToggleRow
                  label={t.webSearchLabel}
                  hint={t.webSearchHint}
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
                {canPickFolder && <AgentWorkspaceRootSection t={t} />}
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
          <SettingsGroup title={t.shortcutAiGroupLabel}>
            <ShortcutRow
              label={t.shortcutTriggerCompletion}
              action="triggerCompletion"
              shortcuts={settings.shortcuts}
              setSettings={setSettings}
              t={t}
            />
            <ShortcutRow
              label={t.shortcutTriggerGrammarCheck}
              action="triggerGrammarCheck"
              shortcuts={settings.shortcuts}
              setSettings={setSettings}
              t={t}
            />
            <ShortcutRow
              label={t.shortcutToggleFloatingChat}
              action="toggleFloatingChat"
              shortcuts={settings.shortcuts}
              setSettings={setSettings}
              t={t}
            />
          </SettingsGroup>
          <SettingsGroup title={t.shortcutEditorGroupLabel}>
            <ShortcutRow
              label={t.shortcutFindReplace}
              action="findReplace"
              shortcuts={settings.shortcuts}
              setSettings={setSettings}
              t={t}
            />
            <ShortcutRow
              label={t.shortcutToggleSidebar}
              action="toggleSidebar"
              shortcuts={settings.shortcuts}
              setSettings={setSettings}
              t={t}
            />
            <ShortcutRow
              label={t.shortcutToggleAgentPanel}
              action="toggleAgentPanel"
              shortcuts={settings.shortcuts}
              setSettings={setSettings}
              t={t}
            />
            <ShortcutRow
              label={t.shortcutToggleSplitView}
              action="toggleSplitView"
              shortcuts={settings.shortcuts}
              setSettings={setSettings}
              t={t}
            />
            <ShortcutRow
              label={t.shortcutToggleZenMode}
              action="toggleZenMode"
              shortcuts={settings.shortcuts}
              setSettings={setSettings}
              t={t}
            />
            <ShortcutRow
              label={t.shortcutToggleSourceMode}
              action="toggleSourceMode"
              shortcuts={settings.shortcuts}
              setSettings={setSettings}
              t={t}
            />
            <ShortcutRow
              label={t.shortcutToggleTypewriterMode}
              action="toggleTypewriterMode"
              shortcuts={settings.shortcuts}
              setSettings={setSettings}
              t={t}
            />
          </SettingsGroup>
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
                <AboutSection t={t} />
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
