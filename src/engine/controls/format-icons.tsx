/**
 * The format bar's glyphs: Lucide's (ISC licence, see THIRD-PARTY-NOTICES.md),
 * drawn like the file icons.
 */
import { lucideIcon } from "./file-icons";

const SIZE = 16;

export const HeadingIcon = lucideIcon(
  <>
    <path d="M6 12h12" />
    <path d="M6 20V4" />
    <path d="M18 20V4" />
  </>,
  SIZE,
);

export const BoldIcon = lucideIcon(
  <path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />,
  SIZE,
);

export const ItalicIcon = lucideIcon(
  <>
    <path d="M19 4h-9" />
    <path d="M14 20H5" />
    <path d="M15 4 9 20" />
  </>,
  SIZE,
);

export const StrikeIcon = lucideIcon(
  <>
    <path d="M16 4H9a3 3 0 0 0-2.83 4" />
    <path d="M14 12a4 4 0 0 1 0 8H6" />
    <path d="M4 12h16" />
  </>,
  SIZE,
);

export const HighlightIcon = lucideIcon(
  <>
    <path d="m9 11-6 6v3h9l3-3" />
    <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
  </>,
  SIZE,
);

export const InlineCodeIcon = lucideIcon(
  <>
    <path d="m16 18 6-6-6-6" />
    <path d="m8 6-6 6 6 6" />
  </>,
  SIZE,
);

export const LinkIcon = lucideIcon(
  <>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </>,
  SIZE,
);

export const ListIcon = lucideIcon(
  <>
    <path d="M3 6h.01" />
    <path d="M3 12h.01" />
    <path d="M3 18h.01" />
    <path d="M8 6h13" />
    <path d="M8 12h13" />
    <path d="M8 18h13" />
  </>,
  SIZE,
);

export const OrderedListIcon = lucideIcon(
  <>
    <path d="M10 6h11" />
    <path d="M10 12h11" />
    <path d="M10 18h11" />
    <path d="M4 6h1v4" />
    <path d="M4 10h2" />
    <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
  </>,
  SIZE,
);

export const QuoteIcon = lucideIcon(
  <>
    <path d="M17 6H3" />
    <path d="M21 12H8" />
    <path d="M21 18H8" />
    <path d="M3 12v6" />
  </>,
  SIZE,
);

export const CodeBlockIcon = lucideIcon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="m10 9-3 3 3 3" />
    <path d="m14 15 3-3-3-3" />
  </>,
  SIZE,
);

export const TableIcon = lucideIcon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    <path d="M3 15h18" />
    <path d="M12 3v18" />
  </>,
  SIZE,
);
