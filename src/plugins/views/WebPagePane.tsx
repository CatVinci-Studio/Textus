import { useKeptLoaded } from "../../utils/kept-loaded";
import { getUiState, setUiState } from "../../storage/ui-state";
import { IconButton } from "../../engine/controls/IconButton";
import { useRef, useState } from "react";
import { Tooltip } from "../../engine/controls/Tooltip";
import { links, webPages } from "../../platform/ipc";
import {
  ChevronIcon,
  DetachIcon,
  RefreshIcon,
} from "../../engine/controls/icons";
import { hasNativeWebPages } from "../../platform/capabilities";
import type { Strings } from "../../i18n/strings";
import { useNativeWebPage } from "./useNativeWebPage";
import { webPageUrl } from "./web-page-url";
import { setWindowTabs } from "../../engine/layout/store";
import type { DocTab } from "../../document/doc-tabs";

/** The address a web tab's page is at now is the tab's: a page loaded
 *  again, the window restored or the tab moved opens it there. */
function keepAddress(tabId: string, address: string): void {
  setWindowTabs<DocTab>((tabs) =>
    tabs.map((tab) =>
      tab.id === tabId &&
      tab.view?.kind === "web" &&
      tab.view.resource !== address
        ? { ...tab, view: { ...tab.view, resource: address } }
        : tab,
    ),
  );
}

function useBarHidden(): [boolean, (hidden: boolean) => void] {
  // One choice for every web page tab.
  const [hidden, setHidden] = useState(
    () => getUiState("webPageBarHidden") === true,
  );
  return [
    hidden,
    (next) => {
      setHidden(next);
      setUiState("webPageBarHidden", next);
    },
  ];
}

/**
 * A web page in a tab, under a slim address bar that folds to a handle. On
 * macOS and Windows it is a native webview laid over the tab, since many sites
 * refuse to be framed; elsewhere a frame. Its origin is never the app's.
 */
export function WebPagePane({
  tabId,
  url,
  shown,
  t,
}: {
  tabId: string;
  url: string;
  /** In front of its island. A frame out of sight is let go after a while,
   *  as native pages are. */
  shown: boolean;
  t: Strings;
}) {
  return hasNativeWebPages ? (
    <NativeWebPage tabId={tabId} url={url} t={t} />
  ) : (
    <KeptFrame tabId={tabId} shown={shown} url={url} t={t} />
  );
}

/** The address typed in the bar, as a page's: https:// added when it has
 *  no scheme. Null for one that can't be shown. */
function typedUrl(address: string): string | null {
  return webPageUrl(
    /^[a-z]+:\/\//i.test(address) ? address : `https://${address}`,
  );
}

function NativeWebPage({
  tabId,
  url,
  t,
}: {
  tabId: string;
  url: string;
  t: Strings;
}) {
  const [shown, setShown] = useState(url);
  const [typed, setTyped] = useState(url);
  const holder = useRef<HTMLDivElement>(null);
  const { failed, retry } = useNativeWebPage(tabId, url, holder, (address) => {
    setShown(address);
    setTyped(address);
    keepAddress(tabId, address);
  });
  return (
    <div className="web-page-pane">
      <AddressBar
        typed={typed}
        onType={setTyped}
        onGo={(address) => {
          const next = typedUrl(address);
          if (!next) return;
          setTyped(next);
          setShown(next);
          void webPages.navigate(tabId, next).catch(() => {});
        }}
        onReload={retry}
        onOutside={() => void links.openWebLink(shown)}
        t={t}
      />
      <div ref={holder} className="web-page-native">
        {failed && (
          <div className="web-page-failed" role="alert">
            <p>{t.webPageFailed}</p>
            <div className="web-page-failed-actions">
              <button
                type="button"
                className="tx-button text-button"
                onClick={retry}
              >
                {t.webPageReload}
              </button>
              <button
                type="button"
                className="tx-button text-button"
                onClick={() => void links.openWebLink(shown)}
              >
                {t.webPageOpenInBrowser}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddressBar({
  typed,
  onType,
  onGo,
  onReload,
  onOutside,
  outsideHint,
  t,
}: {
  typed: string;
  onType: (address: string) => void;
  onGo: (address: string) => void;
  onReload: () => void;
  onOutside: () => void;
  /** More to say on Open in Browser (a frame some sites refuse). */
  outsideHint?: string;
  t: Strings;
}) {
  const [hidden, setHidden] = useBarHidden();
  if (hidden)
    return (
      <div className="web-page-bar web-page-bar-folded">
        <Tooltip text={t.webPageShowBar}>
          <button
            type="button"
            className="web-page-handle"
            aria-label={t.webPageShowBar}
            onClick={() => setHidden(false)}
          >
            <ChevronIcon className="web-page-chevron-down" />
          </button>
        </Tooltip>
      </div>
    );
  return (
    <form
      className="web-page-bar"
      onSubmit={(e) => {
        e.preventDefault();
        onGo(typed.trim());
      }}
    >
      <IconButton
        className="tx-icon-button web-page-button"
        label={t.webPageReload}
        onClick={onReload}
      >
        <RefreshIcon />
      </IconButton>
      <input
        className="web-page-address"
        aria-label={t.webPageAddress}
        value={typed}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onType(e.target.value)}
      />
      <IconButton
        className="tx-icon-button web-page-button"
        label={t.webPageOpenInBrowser}
        hint={
          outsideHint
            ? `${t.webPageOpenInBrowser} - ${outsideHint}`
            : t.webPageOpenInBrowser
        }
        onClick={onOutside}
      >
        <DetachIcon />
      </IconButton>
      <IconButton
        className="tx-icon-button web-page-button"
        label={t.webPageHideBar}
        onClick={() => setHidden(true)}
      >
        <ChevronIcon className="web-page-chevron-up" />
      </IconButton>
    </form>
  );
}

function KeptFrame({
  tabId,
  shown,
  url,
  t,
}: {
  tabId: string;
  shown: boolean;
  url: string;
  t: Strings;
}) {
  return useKeptLoaded("web-frame", shown) ? (
    <FramedWebPage tabId={tabId} url={url} t={t} />
  ) : null;
}

/** The page as a frame, where there are no native pages (Linux, a phone):
 *  only an address typed in its bar is known, not where its links led. */
function FramedWebPage({
  tabId,
  url,
  t,
}: {
  tabId: string;
  url: string;
  t: Strings;
}) {
  const [shown, setShown] = useState(url);
  const [typed, setTyped] = useState(url);
  const frameRef = useRef<HTMLIFrameElement>(null);
  return (
    <div className="web-page-pane">
      <AddressBar
        typed={typed}
        onType={setTyped}
        onGo={(address) => {
          const next = typedUrl(address);
          if (!next) return;
          setTyped(next);
          setShown(next);
          keepAddress(tabId, next);
        }}
        onReload={() => {
          if (frameRef.current) frameRef.current.src = shown;
        }}
        onOutside={() => void links.openWebLink(shown)}
        outsideHint={t.webPageHint}
        t={t}
      />
      <iframe
        ref={frameRef}
        className="web-page-frame"
        title={shown}
        src={shown}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
