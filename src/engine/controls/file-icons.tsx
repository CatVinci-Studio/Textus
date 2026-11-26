/**
 * A file's icon by its extension, every one Lucide's (ISC licence, see
 * THIRD-PARTY-NOTICES.md): Markdown, pictures and anything else from
 * icons.tsx, as are the other kinds' shapes. A file icon theme chosen in
 * Settings draws over them (file-icon-theme.ts).
 */
import type { ReactNode } from "react";
import {
  FILE_KIND_SHAPES,
  FolderIcon,
  FolderOpenIcon,
  GenericFileIcon,
  iconSize,
  ImageFileIcon,
  lucide,
  MarkdownFileIcon,
} from "./icons";
import { themedIconUrl, useIconTable, type IconKind } from "./file-icon-theme";
import { MARKDOWN_EXTENSIONS } from "../../platform/bindings/files";

type IconProps = { className?: string };

/** Each kind's extensions. */
const KINDS: Record<string, string[]> = {
  markdown: [...MARKDOWN_EXTENSIONS],
  image: [
    "png",
    "jpg",
    "jpeg",
    "gif",
    "svg",
    "webp",
    "bmp",
    "heic",
    "avif",
    "tiff",
    "tif",
    "ico",
  ],
  text: ["txt", "log"],
  table: ["base"],
  canvas: ["canvas", "excalidraw"],
  pdf: ["pdf"],
  word: ["doc", "docx", "odt", "rtf", "pages"],
  sheet: ["xls", "xlsx", "csv", "tsv", "numbers", "ods"],
  slides: ["ppt", "pptx", "key", "odp"],
  audio: ["mp3", "wav", "m4a", "flac", "ogg", "aac"],
  video: ["mp4", "mov", "webm", "mkv", "avi"],
  archive: ["zip", "rar", "7z", "tar", "gz", "tgz"],
  code: [
    "js",
    "jsx",
    "ts",
    "tsx",
    "mjs",
    "py",
    "rs",
    "go",
    "c",
    "h",
    "cpp",
    "hpp",
    "java",
    "kt",
    "swift",
    "rb",
    "php",
    "cs",
    "sh",
    "zsh",
    "html",
    "css",
    "scss",
    "vue",
    "sql",
    "lua",
    "r",
  ],
  data: ["json", "jsonc", "yaml", "yml", "toml", "xml", "ini", "conf"],
  tex: ["tex", "sty", "cls"],
  bib: ["bib"],
  book: ["epub"],
  font: ["ttf", "otf", "woff", "woff2"],
};

const KIND_OF = new Map(
  Object.entries(KINDS).flatMap(([kind, exts]) => exts.map((e) => [e, kind])),
);

const ICONS: Record<string, (props: IconProps) => ReactNode> = {
  markdown: MarkdownFileIcon,
  image: ImageFileIcon,
  ...Object.fromEntries(
    Object.entries(FILE_KIND_SHAPES).map(([k, s]) => [k, lucide(s, 15)]),
  ),
};

/** The kind of file a name is, by its extension; null for one we don't
 *  know. */
export function fileKind(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot < 0
    ? null
    : (KIND_OF.get(name.slice(dot + 1).toLowerCase()) ?? null);
}

/** Only the theme's, never a plugin's own markup: an <img> runs no script
 *  an SVG holds. */
function ThemedIcon({ url, className }: { url: string; className?: string }) {
  return (
    <img
      className={className}
      src={url}
      alt=""
      aria-hidden
      draggable={false}
      style={iconSize(15, 15)}
    />
  );
}

function useThemedUrl(name: string, kind: IconKind): string | null {
  const table = useIconTable();
  return table && themedIconUrl(table, name, kind);
}

/** A file's icon wherever a file is listed: the theme's, else the app's. */
export function FileIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const url = useThemedUrl(name, "file");
  if (url) return <ThemedIcon url={url} className={className} />;
  const Icon = fileIconFor(name);
  return <Icon className={className} />;
}

/** A folder's icon in a listing, open or closed. */
export function FolderEntryIcon({
  name,
  open = false,
  className,
}: {
  name: string;
  open?: boolean;
  className?: string;
}) {
  const url = useThemedUrl(name, open ? "folderOpen" : "folder");
  if (url) return <ThemedIcon url={url} className={className} />;
  const Icon = open ? FolderOpenIcon : FolderIcon;
  return <Icon className={className} />;
}

export function fileIconFor(name: string) {
  const kind = fileKind(name);
  return (kind && ICONS[kind]) || GenericFileIcon;
}
