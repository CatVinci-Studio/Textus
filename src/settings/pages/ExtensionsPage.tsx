import { useState } from "react";
import type { SettingsPageProps } from "./types";
import { PluginsPage } from "./PluginsPage";
import { ExtensionsTabLayout } from "./ExtensionsTabLayout";
import { ThemesTab } from "../sections/theme";
import {
  BuiltinSkillsSection,
  OwnSkillsList,
  importSkill,
} from "../sections/skills";
import { McpSection } from "../sections/mcp";
import { errorText } from "../../utils/error-text";
import { MarketPage, type MarketKind } from "./MarketPage";

import {
  extensionsStartTab,
  extensionsTabs,
  openExtensionsTab,
  type ExtensionsTab,
} from "./extensions-tab";

const TABS = extensionsTabs();

/**
 * Settings › Extensions: themes, plugins, skills and MCP servers, a tab
 * each, all laid out alike. Get more is where everything not installed yet
 * is. Desktop only, as plugins are.
 */
export function ExtensionsPage(props: SettingsPageProps) {
  const { t, onOpenFile, onFilesDeleted, onClose } = props;
  const [tab, setTabState] = useState<ExtensionsTab>(extensionsStartTab);
  const [market, setMarket] = useState<MarketKind | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const setTab = (next: ExtensionsTab) => {
    openExtensionsTab(next);
    setTabState(next);
  };
  const label: Record<ExtensionsTab, string> = {
    themes: t.extensionsTabThemes,
    plugins: t.extensionsTabPlugins,
    skills: t.extensionsTabSkills,
    mcp: t.extensionsTabMcp,
  };
  const openMarket = (kind: MarketKind) => setMarket(kind);
  const skillProps = { t, onOpenFile, onFilesDeleted, onClose };
  if (market)
    return <MarketPage t={t} kind={market} onBack={() => setMarket(null)} />;
  return (
    <>
      <div
        className="auth-tabs extensions-tabs"
        role="tablist"
        aria-label={t.navExtensions}
      >
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`auth-tab${tab === id ? " auth-tab-active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label[id]}
          </button>
        ))}
      </div>
      {!props.indexing && (
        <div role="tabpanel" aria-label={label[tab]}>
          {tab === "themes" && (
            <ThemesTab t={t} onGetMore={() => openMarket("themes")} />
          )}
          {tab === "plugins" && (
            <PluginsPage {...props} onGetMore={() => openMarket("plugins")} />
          )}
          {tab === "skills" && (
            <ExtensionsTabLayout
              t={t}
              intro={t.extensionsIntroSkills}
              help={t.extensionsSkillsHelp}
              onGetMore={() => openMarket("skills")}
              actions={[
                {
                  label: t.agentSkillsImport,
                  onSelect: () =>
                    void importSkill().then(
                      () => setSkillError(null),
                      (err: unknown) => setSkillError(errorText(err)),
                    ),
                },
              ]}
              error={skillError}
              installedTitle={t.pluginsInstalledGroup}
              installed={
                <>
                  <OwnSkillsList t={t} />
                  <BuiltinSkillsSection {...skillProps} flat />
                </>
              }
            />
          )}
          {tab === "mcp" && <McpSection t={t} />}
        </div>
      )}
    </>
  );
}
