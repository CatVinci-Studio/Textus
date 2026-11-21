import { useState } from "react";
import { useSettings } from "../prefs/SettingsContext";
import { Sheet } from "../engine/controls/Sheet";
import { Presence } from "../engine/motion/usePresence";
import { CheckIcon, CloseIcon } from "../engine/controls/icons";
import { tabIsDirty, tabTitle, type DocTab } from "../document/doc-tabs";
import "./TabSwitcher.css";

/**
 * The phone's tabs, behind the document's name: the name and its count in
 * the bar open a sheet of every open tab, the one in front ticked, with a
 * × to close one. The desktop keeps its tab row.
 */
export function TabSwitcher({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onAdd,
}: {
  tabs: DocTab[];
  activeTabId: string;
  onActivate: (id: string) => void;
  /** Closing one goes through the window's close (an unsaved tab asks). */
  onClose: (id: string) => void;
  /** The tab row's +, which a phone does not draw: a new tab from here. */
  onAdd: () => void;
}) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  const active = tabs.find((tab) => tab.id === activeTabId);
  return (
    <>
      <button
        type="button"
        className="tab-switcher-button"
        aria-label={t.menuAllTabs}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {active && tabIsDirty(active) && (
          <span className="unsaved-dot" aria-hidden />
        )}
        <span className="tx-truncate tab-switcher-name">
          {active ? tabTitle(active, t) : ""}
        </span>
        <span className="tab-switcher-count">{tabs.length}</span>
      </button>
      <Presence show={open}>
        {open && (
          <Sheet
            role="menu"
            label={t.menuAllTabs}
            className="tab-switcher-sheet"
            onClose={() => setOpen(false)}
          >
            <div className="tab-switcher-group">
              <div className="tab-switcher-title">{t.menuAllTabs}</div>
              {tabs.map((tab) => (
                <div className="tab-switcher-row" key={tab.id}>
                  <button
                    type="button"
                    role="menuitem"
                    aria-current={tab.id === activeTabId ? "true" : undefined}
                    className="tab-switcher-pick"
                    onClick={() => {
                      onActivate(tab.id);
                      setOpen(false);
                    }}
                  >
                    <span className="tx-truncate tab-switcher-tab">
                      {tabTitle(tab, t)}
                    </span>
                    {tab.id === activeTabId && (
                      <CheckIcon className="tab-switcher-check" aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    className="tab-switcher-close"
                    aria-label={t.menuCloseTab}
                    onClick={() => {
                      onClose(tab.id);
                      setOpen(false);
                    }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="tab-switcher-new"
                onClick={() => {
                  onAdd();
                  setOpen(false);
                }}
              >
                <span className="tab-switcher-plus" aria-hidden>
                  +
                </span>
                <span>{t.menuNewTab}</span>
              </button>
            </div>
            <button
              type="button"
              className="tab-switcher-done"
              onClick={() => setOpen(false)}
            >
              {t.cancel}
            </button>
          </Sheet>
        )}
      </Presence>
    </>
  );
}
