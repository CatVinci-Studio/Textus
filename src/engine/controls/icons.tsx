import type { CSSProperties, ReactNode } from "react";
import {
  ArrowUp,
  ArrowDownUp,
  ArrowUpRight,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Book,
  BookMarked,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code,
  Columns2,
  Download,
  Ellipsis,
  Eye,
  File,
  FileArchive,
  FileCode,
  FileCode2,
  FileImage,
  FileJson,
  FileMusic,
  FilePenLine,
  FilePlus,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Folder,
  FolderOpen,
  FolderOpenDot,
  FolderPlus,
  Grid2x2X,
  Heading,
  Highlighter,
  History,
  Italic,
  LayoutGrid,
  LayoutList,
  Lightbulb,
  Link,
  List,
  ListOrdered,
  Lock,
  Menu,
  MessageSquare,
  MessageSquareText,
  PanelLeft,
  Paperclip,
  PenLine,
  Pin,
  Plus,
  Presentation,
  Puzzle,
  RefreshCw,
  Rows2,
  Search,
  Settings,
  Shapes,
  Sparkles,
  Square,
  SquareArrowOutUpRight,
  SquareCode,
  Strikethrough,
  Table,
  Telescope,
  TextQuote,
  Trash2,
  Undo2,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";

/** An icon's drawn size: its design size (the svg's own width and height)
 *  times one step up (--icon-scale) and the interface's scale, so every
 *  icon grows with the interface as its text does. */
export function iconSize(width: number, height: number): CSSProperties {
  const at = (n: number) =>
    `calc(${n}px * var(--icon-scale, 1) * var(--chrome-scale, 1))`;
  return { width: at(width), height: at(height), flexShrink: 0 };
}

/**
 * The app's icons: Lucide's (ISC licence, see THIRD-PARTY-NOTICES.md),
 * one weight for all - a line as thick at every size, drawn at the icon's
 * design size and grown with the interface (iconSize). A new icon takes a
 * Lucide one; only the Windows caption below is drawn here.
 */
type IconProps = { className?: string };

/** The line every icon is drawn with, in px at its design size. */
export const ICON_STROKE = 1.15;

/** Lucide's `Shape` as one of ours, `size` px at design size. */
export function lucide(Shape: LucideIcon, size: number) {
  function Icon({ className, children }: IconProps & { children?: ReactNode }) {
    return (
      <Shape
        className={className}
        size={size}
        style={iconSize(size, size)}
        strokeWidth={ICON_STROKE}
        absoluteStrokeWidth
        aria-hidden
      >
        {children}
      </Shape>
    );
  }
  Icon.displayName = `Icon(${Shape.displayName ?? "lucide"})`;
  return Icon;
}

/** A disclosure triangle's stand-in: turned by CSS when open. */
export const ChevronIcon = lucide(ChevronRight, 10);
/** A menu button's "opens below". */
export const ChevronDownIcon = lucide(ChevronDown, 12);
/** Back and on, a step at a time (a month, a page). */
export const PreviousIcon = lucide(ChevronLeft, 16);
export const NextIcon = lucide(ChevronRight, 16);
export const CommentIcon = lucide(MessageSquare, 11);
/** Take and keep, on a change the AI proposes. */
export const TakeIcon = lucide(Check, 11);
export const DropIcon = lucide(X, 11);
/** A newer release to install (the rail's foot). */
export const DownloadIcon = lucide(Download, 15);
export const EyeIcon = lucide(Eye, 15);

export const FolderIcon = lucide(Folder, 15);
export const FolderOpenIcon = lucide(FolderOpen, 15);
/** The tree's "open as the folder": a folder, its root marked. */
export const ProjectIcon = lucide(FolderOpenDot, 14);
/** The tree's New Folder, and File > Open Folder…. */
export const NewFolderIcon = lucide(FolderPlus, 14);
export const NewDocumentIcon = lucide(FilePlus, 14);
export const MarkdownFileIcon = lucide(FileText, 15);
export const ImageFileIcon = lucide(FileImage, 15);
export const GenericFileIcon = lucide(File, 15);

/** The activity rail's tabs, and Settings at its foot. */
export const TreeTabIcon = lucide(Folder, 15);
export const OutlineTabIcon = lucide(FileText, 15);
export const PluginsTabIcon = lucide(Puzzle, 15);
/** Goes to another place (Settings' way to the plugins panel). */
export const GoToIcon = lucide(ArrowUpRight, 12);
export const SettingsIcon = lucide(Settings, 15);
/** The window bar's sidebar toggle. */
export const SidebarToggleIcon = lucide(PanelLeft, 15);
/** Read-only, beside a document's title. */
export const LockIcon = lucide(Lock, 12);

const AiSparkles = lucide(Sparkles, 16);
/** Textus AI's own button: sparkles, struck through while Textus AI is
 *  off. */
export function AssistantIcon({
  className,
  off = false,
}: IconProps & { off?: boolean }) {
  return (
    <AiSparkles className={className}>
      {off && <path d="M2 2l20 20" />}
    </AiSparkles>
  );
}

export const HistoryIcon = lucide(History, 13);
/** "More actions" on a row (the iPhone document list). */
export const MoreIcon = lucide(Ellipsis, 16);
export const CloseIcon = lucide(X, 12);
/** Pop out into a separate window. */
export const DetachIcon = lucide(SquareArrowOutUpRight, 13);
/** Keep the detached chat window above the editor. */
export const PinIcon = lucide(Pin, 13);
export const PlusIcon = lucide(Plus, 13);
export const SearchIcon = lucide(Search, 13);
/** The composer's Deep thinking toggle. */
export const LightbulbIcon = lucide(Lightbulb, 13);
export const PaperclipIcon = lucide(Paperclip, 13);
export const CheckIcon = lucide(Check, 13);
export const ArrowUpIcon = lucide(ArrowUp, 12);
/** Stop a reply: a filled square. */
export function StopIcon({ className }: IconProps) {
  return (
    <Square
      className={className}
      size={12}
      style={iconSize(12, 12)}
      strokeWidth={ICON_STROKE}
      absoluteStrokeWidth
      fill="currentColor"
      aria-hidden
    />
  );
}
export const SortIcon = lucide(ArrowDownUp, 13);
export const RefreshIcon = lucide(RefreshCw, 12);
/** The way into the app menu, once the native menu bar is gone. */
export const HamburgerIcon = lucide(Menu, 12);

/** Undo (the iPhone keyboard toolbar). */
export const UndoIcon = lucide(Undo2, 16);
export const BulletListIcon = lucide(List, 16);
export const NumberedListIcon = lucide(ListOrdered, 16);

/** The format bar's. */
export const HeadingIcon = lucide(Heading, 16);
export const BoldIcon = lucide(Bold, 16);
export const ItalicIcon = lucide(Italic, 16);
export const StrikeIcon = lucide(Strikethrough, 16);
export const HighlightIcon = lucide(Highlighter, 16);
export const InlineCodeIcon = lucide(Code, 16);
export const LinkIcon = lucide(Link, 16);
export const QuoteIcon = lucide(TextQuote, 16);
export const CodeBlockIcon = lucide(SquareCode, 16);
export const TableIcon = lucide(Table, 16);

/** A file's kind, by the shape the file tree shows (file-icons.ts). */
export const FILE_KIND_SHAPES: Record<string, LucideIcon> = {
  text: FileText,
  table: Table,
  canvas: Shapes,
  pdf: BookOpenText,
  word: FilePenLine,
  sheet: FileSpreadsheet,
  slides: Presentation,
  audio: FileMusic,
  video: FileVideo,
  archive: FileArchive,
  code: FileCode,
  data: FileJson,
  tex: FileCode2,
  bib: BookMarked,
  book: Book,
  font: FileType,
};

/** A table's row and column actions, by what they do. */
const TABLE_EDIT_ICONS = {
  "row-above": lucide(BetweenHorizontalStart, 16),
  "row-below": lucide(BetweenHorizontalEnd, 16),
  "column-left": lucide(BetweenVerticalStart, 16),
  "column-right": lucide(BetweenVerticalEnd, 16),
  "delete-row": lucide(Rows2, 16),
  "delete-column": lucide(Columns2, 16),
  "delete-table": lucide(Grid2x2X, 16),
} as const;

export function TableEditIcon({
  kind,
  className,
}: IconProps & { kind: keyof typeof TABLE_EDIT_ICONS }) {
  const Shape = TABLE_EDIT_ICONS[kind];
  return <Shape className={className} />;
}

export const TrashIcon = lucide(Trash2, 16);
/** Documents list: as a grid of page thumbnails, or as rows. */
export const GridViewIcon = lucide(LayoutGrid, 16);
export const ListViewIcon = lucide(LayoutList, 16);

/** The AI's modes. */
export const WriteModeIcon = lucide(PenLine, 13);
export const CreateModeIcon = lucide(WandSparkles, 13);
export const ReviewModeIcon = lucide(MessageSquareText, 13);
export const ResearchModeIcon = lucide(Telescope, 13);

type IconNode = [string, Record<string, string | number>][];

/** `Shape` as svg markup, `size` px in the icons' one weight: for what a
 *  node view builds outside React. */
export function iconMarkup(Shape: LucideIcon, size: number): string {
  // lucide-react (pinned) keeps its shape on the element it renders.
  const render = (
    Shape as unknown as {
      render: (p: object, r: null) => { props: { iconNode: IconNode } };
    }
  ).render;
  const parts = render({}, null).props.iconNode.map(
    ([tag, attrs]) =>
      `<${tag} ${Object.entries(attrs)
        .filter(([k]) => k !== "key")
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ")}/>`,
  );
  const stroke = (ICON_STROKE * 24) / size;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${parts.join("")}</svg>`;
}

export const IMAGE_ICON_HTML = iconMarkup(FileImage, 15);
export const PLUS_ICON_HTML = iconMarkup(Plus, 15);
/** Take and keep, on a change the AI proposes. */
export const CHECK_ICON_HTML = iconMarkup(Check, 11);
export const CROSS_ICON_HTML = iconMarkup(X, 11);

/* The window caption, drawn only where the app owns the frame (Windows).
   These break the 16-unit grid on purpose: Windows caption glyphs are fixed
   10x10 hairlines every app draws alike. */

export function WindowMinimizeIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="10"
      height="10"
      style={iconSize(10, 10)}
      viewBox="0 0 10 10"
      fill="none"
    >
      <path d="M1 5h8" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function WindowMaximizeIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="10"
      height="10"
      style={iconSize(10, 10)}
      viewBox="0 0 10 10"
      fill="none"
    >
      <rect
        x="1.5"
        y="1.5"
        width="7"
        height="7"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

/** Maximized state: the two offset squares Windows uses for "restore down". */
export function WindowRestoreIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="10"
      height="10"
      style={iconSize(10, 10)}
      viewBox="0 0 10 10"
      fill="none"
    >
      <path
        d="M3 3V1.5h5.5V7H7"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <rect
        x="1.5"
        y="3.5"
        width="5.5"
        height="5"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

export function WindowCloseIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="10"
      height="10"
      style={iconSize(10, 10)}
      viewBox="0 0 10 10"
      fill="none"
    >
      <path
        d="M1.5 1.5l7 7M8.5 1.5l-7 7"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}
