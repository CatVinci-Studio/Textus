/**
 * A file's icon by its extension, every one Lucide's (ISC licence, see
 * THIRD-PARTY-NOTICES.md): Markdown, pictures and anything else from
 * icons.tsx, the other kinds' shapes here, in the same weight.
 */
import type { ReactNode } from "react";
import {
  GenericFileIcon,
  ICON_STROKE,
  iconSize,
  ImageFileIcon,
  MarkdownFileIcon,
} from "./icons";

type IconProps = { className?: string };

const page = (
  <>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </>
);

/** Lucide's shapes, by the kind of file. */
const SHAPES: Record<string, ReactNode> = {
  text: (
    <>
      {page}
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </>
  ),
  table: (
    <>
      <path d="M12 3v18" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
    </>
  ),
  canvas: (
    <>
      <path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <circle cx="17.5" cy="17.5" r="3.5" />
    </>
  ),
  pdf: (
    <>
      <path d="M12 7v14" />
      <path d="M16 12h2" />
      <path d="M16 8h2" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
      <path d="M6 12h2" />
      <path d="M6 8h2" />
    </>
  ),
  word: (
    <>
      <path d="m18 5-2.414-2.414A2 2 0 0 0 14.172 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2" />
      <path d="M21.378 12.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
      <path d="M8 18h1" />
    </>
  ),
  sheet: (
    <>
      {page}
      <path d="M8 13h2" />
      <path d="M14 13h2" />
      <path d="M8 17h2" />
      <path d="M14 17h2" />
    </>
  ),
  slides: (
    <>
      <path d="M2 3h20" />
      <path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" />
      <path d="m7 21 5-5 5 5" />
    </>
  ),
  audio: (
    <>
      <path d="M10.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v8.4" />
      <path d="M8 18v-7.7L16 9v7" />
      <circle cx="14" cy="16" r="2" />
      <circle cx="6" cy="18" r="2" />
    </>
  ),
  video: (
    <>
      {page}
      <path d="m10 11 5 3-5 3v-6Z" />
    </>
  ),
  archive: (
    <>
      <path d="M10 12v-1" />
      <path d="M10 18v-2" />
      <path d="M10 7V6" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M15.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v16a2 2 0 0 0 .274 1.01" />
      <circle cx="10" cy="20" r="2" />
    </>
  ),
  code: (
    <>
      <path d="M10 12.5 8 15l2 2.5" />
      <path d="m14 12.5 2 2.5-2 2.5" />
      {page}
    </>
  ),
  data: (
    <>
      {page}
      <path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1" />
      <path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1" />
    </>
  ),
  tex: (
    <>
      <path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="m5 12-3 3 3 3" />
      <path d="m9 18 3-3-3-3" />
    </>
  ),
  bib: (
    <>
      <path d="M10 2v8l3-3 3 3V2" />
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
    </>
  ),
  book: (
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  ),
  font: (
    <>
      {page}
      <path d="M9 13v-1h6v1" />
      <path d="M12 12v6" />
      <path d="M11 18h2" />
    </>
  ),
};

/** Each kind's extensions. */
const KINDS: Record<string, string[]> = {
  markdown: ["md", "markdown", "mdx"],
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

/** A Lucide shape drawn as one of ours: `size` px, the icons' one line
 *  weight (as icons.tsx's lucide()). */
export function lucideIcon(shape: ReactNode, size = 15) {
  return function LucideIcon({ className }: IconProps) {
    return (
      <svg
        className={className}
        width={size}
        height={size}
        style={iconSize(size, size)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={(ICON_STROKE * 24) / size}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {shape}
      </svg>
    );
  };
}

const ICONS: Record<string, (props: IconProps) => ReactNode> = {
  markdown: MarkdownFileIcon,
  image: ImageFileIcon,
  ...Object.fromEntries(
    Object.entries(SHAPES).map(([k, s]) => [k, lucideIcon(s)]),
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

export function fileIconFor(name: string) {
  const kind = fileKind(name);
  return (kind && ICONS[kind]) || GenericFileIcon;
}
