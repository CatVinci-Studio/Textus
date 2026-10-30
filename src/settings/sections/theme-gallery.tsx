import { useEffect, useRef, useState } from "react";
import type { Strings } from "../../i18n/strings";
import { links, themeGallery } from "../../platform/ipc";
import {
  galleryStatus,
  installGalleryTheme,
  installedCopy,
  type GalleryStatus,
  type GalleryTheme,
  localizedTheme,
} from "../../theme/theme-gallery";
import { withUserTheme } from "../../theme/theme-import";
import { useLatest } from "../../utils/hooks/useLatest";
import { useSettings } from "../../prefs/SettingsContext";
import { SettingRow } from "./controls";
import { explainError } from "../../utils/error-explain";
import { openDiagramViewer } from "../../editor/diagram-zoom";
import { AvailableSection } from "../pages/AvailableSection";
import { installsText } from "../pages/installs-text";
import { matchesWords } from "../../utils/match-words";

/** The themes whose name, author or description hold every word of
 *  `query`. */
function searchThemes(list: GalleryTheme[], query: string): GalleryTheme[] {
  return list.filter((theme) =>
    matchesWords(
      [theme.name, theme.author, theme.description].join("\n"),
      query,
    ),
  );
}

/** The user's themes the gallery has a newer version of, by their id. */
export function galleryUpdates(
  catalog: GalleryTheme[] | null,
  userThemes: Parameters<typeof installedCopy>[1],
): Map<string, GalleryTheme> {
  const out = new Map<string, GalleryTheme>();
  for (const theme of catalog ?? []) {
    const installed = installedCopy(theme, userThemes);
    if (installed && galleryStatus(theme, installed) === "update")
      out.set(installed.id, theme);
  }
  return out;
}

/** Installing a gallery theme (or its update) into the user's themes; a
 *  first install is put to use. */
export function useGalleryInstall(t: Strings) {
  const { settings, setSettings } = useSettings();
  const latest = useLatest(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);

  async function install(theme: GalleryTheme) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      const installed = installedCopy(theme, latest.current.userThemes);
      const meta = await installGalleryTheme(theme, installed);
      setSettings({
        userThemes: withUserTheme(latest.current.userThemes, meta),
        ...(installed ? {} : { themeId: meta.id }),
      });
    } catch (err) {
      setError(`${t.themeGalleryInstallFailed} ${explainError(err, t)}`);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return { busy, error, install };
}

/** Settings › Extensions › Themes, under the user's themes: the gallery's
 *  themes not installed yet. */
export function AvailableThemes({
  t,
  query,
  gallery,
  install,
}: {
  t: Strings;
  query: string;
  gallery: ReturnType<typeof useGalleryCatalog>;
  install: ReturnType<typeof useGalleryInstall>;
}) {
  const { settings } = useSettings();
  const { catalog, unreachable, retry } = gallery;
  const shown = (catalog ? searchThemes(catalog, query) : []).filter(
    (theme) => !installedCopy(theme, settings.userThemes),
  );
  const message = unreachable ? (
    <GalleryUnreachable t={t} retry={retry} />
  ) : !catalog ? (
    <GalleryLoading t={t} />
  ) : query.trim() && !shown.length ? (
    <p className="plugin-empty">
      {t.pluginsSearchNone.replace("{query}", query.trim())}
    </p>
  ) : undefined;
  return (
    <AvailableSection
      t={t}
      kind="themes"
      searching={!!query.trim()}
      message={message}
      note={
        install.error && (
          <div className="settings-error" role="alert">
            {install.error}
          </div>
        )
      }
      rows={shown.map((theme) => (
        <GalleryItem
          key={theme.id}
          t={t}
          theme={theme}
          status="install"
          inUse={false}
          busy={install.busy}
          onInstall={() => void install.install(theme)}
          onUse={() => {}}
        />
      ))}
    />
  );
}

function GalleryLoading({ t }: { t: Strings }) {
  return (
    <div className="theme-gallery-message settings-row-hint" role="status">
      {t.themeGalleryLoading}
    </div>
  );
}

function GalleryUnreachable({ t, retry }: { t: Strings; retry: () => void }) {
  return (
    <div className="theme-gallery-message" role="status">
      <div className="settings-row-hint">{t.themeGalleryUnreachable}</div>
      <div className="theme-gallery-message-actions">
        <button
          type="button"
          className="text-button settings-inline-button"
          onClick={retry}
        >
          {t.themeGalleryRetry}
        </button>
        <button
          type="button"
          className="text-button settings-inline-button"
          onClick={() => void links.openAboutLink("themes")}
        >
          {t.themeGalleryWebsite}
        </button>
      </div>
    </div>
  );
}

function GalleryItem({
  t,
  theme,
  status,
  inUse,
  busy,
  onInstall,
  onUse,
}: {
  t: Strings;
  theme: GalleryTheme;
  status: GalleryStatus;
  inUse: boolean;
  busy: boolean;
  onInstall: () => void;
  onUse: () => void;
}) {
  const byline = t.themeGalleryBy.replace("{author}", theme.author);
  return (
    // The hint is cut to two lines; the whole description is on hover.
    <div
      className="theme-gallery-item"
      aria-label={theme.name}
      role="group"
      title={theme.description}
    >
      <GalleryPreview
        path={theme.previews[0]}
        label={`${t.themePreviewEnlarge}: ${theme.name}`}
      />
      <SettingRow
        label={theme.name}
        hint={[
          theme.author && byline,
          installsText(theme, t),
          theme.description,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        {status === "install" ? (
          <button
            type="button"
            className="text-button settings-inline-button"
            disabled={busy}
            onClick={onInstall}
          >
            {t.themeGalleryInstall}
          </button>
        ) : (
          <>
            {status === "update" ? (
              <button
                type="button"
                className="text-button settings-inline-button"
                disabled={busy}
                onClick={onInstall}
              >
                {t.themeGalleryUpdate}
              </button>
            ) : (
              <span className="settings-row-value">
                {inUse ? t.themeGalleryInUse : t.themeGalleryInstalled}
              </span>
            )}
            {!inUse && (
              <button
                type="button"
                className="text-button settings-inline-button"
                disabled={busy}
                onClick={onUse}
              >
                {t.themeGalleryUse}
              </button>
            )}
          </>
        )}
      </SettingRow>
    </div>
  );
}

/** Screenshots fetched at once, at most: a long catalog scrolled quickly
 *  shouldn't start a download per row. */
const MAX_PREVIEW_FETCHES = 3;
let previewFetches = 0;
const waitingFetches: (() => void)[] = [];

/** Runs `task` once one of the preview slots is free. A finished task hands
 *  its slot straight to the next waiting one, so the count never overshoots. */
async function inPreviewSlot<T>(task: () => Promise<T>): Promise<T> {
  if (previewFetches < MAX_PREVIEW_FETCHES) previewFetches++;
  else await new Promise<void>((resolve) => waitingFetches.push(resolve));
  try {
    return await task();
  } finally {
    const next = waitingFetches.shift();
    if (next) next();
    else previewFetches--;
  }
}

/** A theme's first screenshot, fetched through the backend as a `data:` URL
 *  once its row scrolls into view; an empty frame until then. A click shows
 *  it large, in the picture viewer. */
function GalleryPreview({
  path,
  label,
}: {
  path: string | undefined;
  label: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el || visible) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!path || !visible) return;
    let cancelled = false;
    inPreviewSlot(() =>
      // A row closed while it waited for a slot needs no download.
      cancelled ? Promise.resolve(null) : themeGallery.preview(path),
    )
      .then((url) => !cancelled && setSrc(url))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path, visible]);

  return (
    <div className="theme-gallery-preview" ref={frame}>
      {src && (
        <button
          type="button"
          className="theme-gallery-enlarge"
          aria-label={label}
          onClick={(e) => {
            const img = e.currentTarget.querySelector("img");
            if (img) openDiagramViewer(img, e.currentTarget);
          }}
        >
          <img src={src} alt="" draggable={false} />
        </button>
      )}
    </div>
  );
}

/** The gallery's catalog, fetched as the page opens and again on `retry`;
 *  `unreachable` when the fetch failed. */
export function useGalleryCatalog() {
  const { settings } = useSettings();
  const [themes, setCatalog] = useState<GalleryTheme[] | null>(null);
  const catalog =
    themes?.map((theme) => localizedTheme(theme, settings.language)) ?? null;
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    setUnreachable(false);
    themeGallery
      .catalog()
      .then((themes) => !cancelled && setCatalog(themes))
      .catch(() => !cancelled && setUnreachable(true));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { catalog, unreachable, retry: () => setAttempt((n) => n + 1) };
}
