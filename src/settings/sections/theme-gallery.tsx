import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import type { Strings } from "../../i18n/strings";
import { links, themeGallery } from "../../platform/ipc";
import {
  galleryStatus,
  installGalleryTheme,
  installedCopy,
  type GalleryTheme,
  localizedTheme,
} from "../../theme/theme-gallery";
import { withUserTheme } from "../../theme/theme-import";
import { isEffectiveDark } from "../../theme/apply-appearance";
import { useLatest } from "../../utils/hooks/useLatest";
import { useSettings } from "../../prefs/SettingsContext";
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
  onOpen,
}: {
  t: Strings;
  query: string;
  gallery: ReturnType<typeof useGalleryCatalog>;
  install: ReturnType<typeof useGalleryInstall>;
  onOpen: (theme: GalleryTheme) => void;
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
          busy={install.busy}
          onInstall={() => void install.install(theme)}
          onOpen={() => onOpen(theme)}
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

/** A theme's card, installed or in the gallery alike: its screenshot (an
 *  empty sample when it has none), its name, line and byline - opening its
 *  page when it has one - and its buttons. */
export function ThemeCard({
  t,
  name,
  description,
  previews,
  byline,
  onOpen,
  children,
  ...rest
}: {
  t: Strings;
  name: string;
  description?: string;
  previews?: string[];
  byline?: ReactNode;
  onOpen?: () => void;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const text = (
    <>
      <span className="settings-row-label plugin-card-name">{name}</span>
      {description && (
        <span className="settings-row-hint plugin-card-description">
          {description}
        </span>
      )}
      {byline}
    </>
  );
  return (
    <div
      {...rest}
      className="theme-gallery-item"
      aria-label={name}
      role="group"
    >
      {previews?.length ? (
        <GalleryPreview
          paths={previews}
          label={`${t.themePreviewEnlarge}: ${name}`}
        />
      ) : (
        <div className="theme-gallery-preview theme-sample" aria-hidden>
          Aa
        </div>
      )}
      {onOpen ? (
        <button type="button" className="plugin-card-open" onClick={onOpen}>
          {text}
        </button>
      ) : (
        <div className="plugin-card-open">{text}</div>
      )}
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

/** A gallery theme's card: Install beside it. */
function GalleryItem({
  t,
  theme,
  busy,
  onInstall,
  onOpen,
}: {
  t: Strings;
  theme: GalleryTheme;
  busy: boolean;
  onInstall: () => void;
  onOpen: () => void;
}) {
  return (
    <ThemeCard
      t={t}
      name={theme.name}
      description={theme.description}
      previews={theme.previews}
      byline={<ThemeByline t={t} theme={theme} />}
      onOpen={onOpen}
    >
      <button
        type="button"
        className="text-button settings-inline-button"
        disabled={busy}
        onClick={onInstall}
      >
        {t.themeGalleryInstall}
      </button>
    </ThemeCard>
  );
}

/** The gallery's entry for each installed theme, by the installed id. */
export function galleryCopies(
  catalog: GalleryTheme[] | null,
  userThemes: Parameters<typeof installedCopy>[1],
): Map<string, GalleryTheme> {
  const out = new Map<string, GalleryTheme>();
  for (const theme of catalog ?? []) {
    const installed = installedCopy(theme, userThemes);
    if (installed) out.set(installed.id, theme);
  }
  return out;
}

/** Who made a gallery theme and how often it was installed. */
export function ThemeByline({ t, theme }: { t: Strings; theme: GalleryTheme }) {
  const installs = installsText(theme, t);
  return (
    <span className="plugin-byline">
      {theme.author && (
        <span>{t.themeGalleryBy.replace("{author}", theme.author)}</span>
      )}
      {installs && <span className="plugin-installs">{installs}</span>}
    </span>
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

/** A theme's screenshot - `at`, else the one for the current appearance:
 *  the second, a theme's dark look, in dark - fetched through the backend as
 *  a `data:` URL once it scrolls into view; an empty frame until then. A
 *  click shows it large in the picture viewer, the others a step away. */
export function GalleryPreview({
  paths,
  label,
  at,
  large,
}: {
  paths: string[];
  label: string;
  at?: number;
  large?: boolean;
}) {
  const { settings } = useSettings();
  const shown =
    at ?? (isEffectiveDark(settings.theme) && paths.length > 1 ? 1 : 0);
  const path = paths[shown];
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
    <div
      className={`theme-gallery-preview${large ? " is-large" : ""}`}
      ref={frame}
    >
      {src && (
        <button
          type="button"
          className="theme-gallery-enlarge"
          aria-label={label}
          onClick={(e) => {
            const img = e.currentTarget.querySelector("img");
            const pictures = paths.map((p, i) =>
              i === shown && src
                ? src
                : themeGallery.preview(p).catch(() => null),
            );
            if (img)
              openDiagramViewer(img, e.currentTarget, { pictures, at: shown });
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
