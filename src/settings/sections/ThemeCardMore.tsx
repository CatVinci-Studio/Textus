import { useMenuButton } from "../../engine/controls/useMenuButton";
import type { Strings } from "../../i18n/strings";

/** An installed theme's ⋯: export its own files, or delete it. */
export function ThemeCardMore({
  t,
  name,
  onExport,
  onDelete,
}: {
  t: Strings;
  name: string;
  onExport: () => void;
  onDelete: () => void;
}) {
  const { button, menu } = useMenuButton(
    () => [
      { label: t.themeExportOne, onSelect: onExport },
      { label: t.themeDeleteButton, onSelect: onDelete, danger: true },
    ],
    { alignEnd: true, title: name },
  );
  return (
    <>
      <button
        type="button"
        className="tx-button text-button settings-inline-button"
        aria-label={`${t.toolbarMore}: ${name}`}
        {...button}
      >
        ⋯
      </button>
      {menu}
    </>
  );
}
