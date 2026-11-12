/**
 * A file's icon by its extension, every one Lucide's (ISC licence, see
 * THIRD-PARTY-NOTICES.md): Markdown, pictures and anything else from
 * icons.tsx, as are the other kinds' shapes.
 */
import type { ReactNode } from "react";
import {
  FILE_KIND_SHAPES,
  GenericFileIcon,
  ImageFileIcon,
  lucide,
  MarkdownFileIcon,
} from "./icons";

type IconProps = { className?: string };

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

export function fileIconFor(name: string) {
  const kind = fileKind(name);
  return (kind && ICONS[kind]) || GenericFileIcon;
}
