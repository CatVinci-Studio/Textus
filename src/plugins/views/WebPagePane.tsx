import { useRef, useState } from "react";
import { links, webPages } from "../../platform/ipc";
import { ChevronIcon, DetachIcon, RefreshIcon } from "../../ui/icons";
import { hasNativeWebPages } from "../../platform/capabilities";
import type { Strings } from "../../i18n/strings";
import { useNativeWebPage } from "./useNativeWebPage";
import { webPageUrl } from "./web-page-url";

/** Whether the address bar is folded away: one choice for every web page tab. */
const BAR_HIDDEN_KEY = "textus.webPageBarHidden";

function useBarHidden(): [boolean, (hidden: boolean) => void] {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(BAR_HIDDEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  return [
    hidden,
    (next) => {
      setHidden(next);
      try {
        localStorage.setItem(BAR_HIDDEN_KEY, next ? "1" : "0");
      } catch {
        // Not kept; this tab still folds it.
      }
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
  t,
}: {
  tabId: string;
  url: string;
  t: Strings;
}) {
  return hasNativeWebPages ? (
    <NativeWebPage tabId={tabId} url={url} t={t} />
  ) : (
    <FramedWebPage url={url} t={t} />
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
              <button type="button" className="text-button" onClick={retry}>
                {t.webPageReload}
              </button>
              <button
                type="button"
                className="text-button"
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
        <button
          type="button"
          className="web-page-handle"
          aria-label={t.webPageShowBar}
          title={t.webPageShowBar}
          onClick={() => setHidden(false)}
        >
          <ChevronIcon className="web-page-chevron-down" />
        </button>
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
      <button
        type="button"
        className="icon-button web-page-button"
        aria-label={t.webPageReload}
        title={t.webPageReload}
        onClick={onReload}
      >
        <RefreshIcon />
      </button>
      <input
        className="web-page-address"
        aria-label={t.webPageAddress}
        value={typed}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onType(e.target.value)}
      />
      <button
        type="button"
        className="icon-button web-page-button"
        aria-label={t.webPageOpenInBrowser}
        title={
          outsideHint
            ? `${t.webPageOpenInBrowser} - ${outsideHint}`
            : t.webPageOpenInBrowser
        }
        onClick={onOutside}
      >
        <DetachIcon />
      </button>
      <button
        type="button"
        className="icon-button web-page-button"
        aria-label={t.webPageHideBar}
        title={t.webPageHideBar}
        onClick={() => setHidden(true)}
      >
        <ChevronIcon className="web-page-chevron-up" />
      </button>
    </form>
  );
}

/** The page as a frame, where there are no native pages (Linux, a phone). */
function FramedWebPage({ url, t }: { url: string; t: Strings }) {
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
