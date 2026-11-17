import { counted } from "../../i18n/current";
import type { Strings } from "../../i18n/strings";
import { useMenuButton } from "../../engine/controls/useMenuButton";
import { useSlips } from "../../editor/issues/slips-by-tab";

/** How many slips plugins found in the document, beside its count, only
 *  while there are some; pressed, the list of them, each taking the caret
 *  to its card. */
export function SlipCount({ tabId, t }: { tabId: string; t: Strings }) {
  const slips = useSlips(tabId);
  const label = counted(t.slipCount, slips.length);
  const { button, menu } = useMenuButton(
    () =>
      slips.map((slip) => ({
        label: slip.label ? `${slip.label}: ${slip.message}` : slip.message,
        onSelect: slip.go,
      })),
    { title: label, alignEnd: true },
  );
  if (!slips.length) return null;
  return (
    <>
      <button type="button" className="slip-count" {...button}>
        {label}
      </button>
      {menu}
    </>
  );
}
