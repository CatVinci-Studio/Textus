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
import type { McpServer } from "../mcp";
import { errorText } from "../../utils/error-text";
import { openUsageGuide } from "../../plugins/usage-guide";
import { MarketPage, type MarketKind } from "./MarketPage";

import {
  extensionsStartTab,
  extensionsTabs,
  openExtensionsTab,
  type ExtensionsTab,
} from "./extensions-tab";

const TABS = extensionsTabs();

/**
 * Settings › Extensions: everything added to Textus, one tab each -
 * plugins (the textus-plugins catalog), themes (the theme gallery), skills
 * (the built-ins, five on to start with, and the user's own), and MCP
 * servers. Every tab is laid out alike (ExtensionsTabLayout): what it
 * holds in a line, Get more and "⋯", what is installed, Advanced. Get more
 * (MarketPage) is where everything not installed yet is. Desktop only, as
 * plugins are.
 */
export function ExtensionsPage(props: SettingsPageProps) {
  const { t, onOpenFile, onFilesDeleted, onClose } = props;
  const [tab, setTabState] = useState<ExtensionsTab>(extensionsStartTab);
  // Get more, opened on a kind.
  const [market, setMarket] = useState<MarketKind | null>(null);
  // An MCP server Get more sent to the MCP tab's form.
  const [adding, setAdding] = useState<McpServer | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const setTab = (next: ExtensionsTab) => {
    openExtensionsTab(next);
    setTabState(next);
    setAdding(null);
  };
  const label: Record<ExtensionsTab, string> = {
    plugins: t.extensionsTabPlugins,
    themes: t.extensionsTabThemes,
    skills: t.extensionsTabSkills,
    mcp: t.extensionsTabMcp,
  };
  // The server taken to the form is filled in once: not again on coming
  // back from Get more.
  const openMarket = (kind: MarketKind) => {
    setAdding(null);
    setMarket(kind);
  };
  const skillProps = { t, onOpenFile, onFilesDeleted, onClose };
  if (market)
    return (
      <MarketPage
        t={t}
        kind={market}
        onBack={() => setMarket(null)}
        builtinSkills={(query) => (
          <BuiltinSkillsSection {...skillProps} only="off" query={query} />
        )}
        // A plugin just installed shows how it is used: its guide in a
        // tab, Settings out of the way.
        onInstalled={(id) =>
          void openUsageGuide(id).then((opened) => {
            if (opened) onClose();
          })
        }
        onAddMcp={(server) => {
          setMarket(null);
          setTab("mcp");
          setAdding(server);
        }}
      />
    );
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
          {tab === "plugins" && (
            <PluginsPage {...props} onGetMore={() => openMarket("plugins")} />
          )}
          {tab === "themes" && (
            <ThemesTab t={t} onGetMore={() => openMarket("themes")} />
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
                  <BuiltinSkillsSection {...skillProps} only="on" />
                </>
              }
            />
          )}
          {tab === "mcp" && (
            <McpSection
              key={adding?.id ?? ""}
              t={t}
              adding={adding}
              onGetMore={() => openMarket("mcp")}
            />
          )}
        </div>
      )}
    </>
  );
}
