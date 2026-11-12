import type { ReactNode } from "react";
import {
  BulletListIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  FolderIcon,
  GenericFileIcon,
  HistoryIcon,
  ImageFileIcon,
  LinkIcon,
  PinIcon,
  SearchIcon,
  StarIcon,
  TagIcon,
} from "../../engine/controls/icons";

const ICONS: Record<string, (props: { className?: string }) => ReactNode> = {
  file: GenericFileIcon,
  folder: FolderIcon,
  image: ImageFileIcon,
  task: CheckIcon,
  history: HistoryIcon,
  pin: PinIcon,
  search: SearchIcon,
  list: BulletListIcon,
  star: StarIcon,
  tag: TagIcon,
  clock: ClockIcon,
  calendar: CalendarIcon,
  link: LinkIcon,
};

/** A list row's icon: one of the app's by name, else the item's own glyph
 *  (a page's emoji) in its place. */
export function ListRowIcon({ icon }: { icon?: string }) {
  if (!icon) return null;
  const Icon = ICONS[icon];
  if (Icon) return <Icon className="plugin-list-icon" />;
  return (
    <span className="plugin-list-icon is-glyph" aria-hidden="true">
      {icon}
    </span>
  );
}
