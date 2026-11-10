import { createContext, useContext, type ReactNode } from "react";
import { makeBlankTab, type DocTab } from "../../document/doc-tabs";
import type { TabState } from "./useTabState";
import "./page-tabs.css";

/**
 * Textus's own pages shown as tabs - Settings, a plugin's page: tabs like
 * any other (dragged into any island, split off), one of each in a window,
 * opened again by going to it (the plugin page showing the plugin last
 * opened from the sidebar's list). What they show comes from the window
 * (PageTabProvider), which knows what each needs.
 */
export type AppPage = "settings" | "plugins" | "create";

/** Where a page is asked to go: a Settings category, a plugin; `at` is
 *  new on each request, so an open page takes it too. */
export interface PageRequest {
  to?: string;
  at: number;
  /** A row to go to there (a Settings search result). */
  jump?: unknown;
}

/** The page tab `tab` shows, if it is one. */
export function pageOf(tab: DocTab | undefined): AppPage | null {
  return tab?.view?.kind === "page" ? (tab.view.view as AppPage) : null;
}

/** Brings `page`'s tab to the front, opening it where tabs open if there
 *  is none; `to` is where in it to go, `title` what the tab is called
 *  there (a plugin's name). */
export function showPage(
  tabs: TabState,
  page: AppPage,
  to?: string,
  title?: string,
  jump?: unknown,
): void {
  const state: PageRequest = { to, at: Date.now(), jump };
  const open = tabs.tabsRef.current.find((tab) => pageOf(tab) === page);
  if (open) {
    if (to) tabs.updateTab(open.id, { view: { ...open.view!, state, title } });
    tabs.setActiveTabId(open.id);
    return;
  }
  const made: DocTab = {
    ...makeBlankTab(),
    view: { plugin: "textus", view: page, kind: "page", state, title },
  };
  tabs.setTabs((prev) => [...prev, made]);
  tabs.setActiveTabId(made.id);
}

type RenderPage = (page: AppPage, request: PageRequest | null) => ReactNode;

const PageTabContext = createContext<RenderPage>(() => null);

/** What each page tab of this window shows. */
export function PageTabProvider({
  render,
  children,
}: {
  render: RenderPage;
  children: ReactNode;
}) {
  return (
    <PageTabContext.Provider value={render}>{children}</PageTabContext.Provider>
  );
}

/** A page tab's content. */
export function PageTabContent({ tab }: { tab: DocTab }) {
  const render = useContext(PageTabContext);
  const page = pageOf(tab);
  if (!page) return null;
  return (
    <div className="page-tab">
      {render(page, (tab.view?.state as PageRequest | undefined) ?? null)}
    </div>
  );
}
