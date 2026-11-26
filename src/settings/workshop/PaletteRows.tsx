import type { CSSProperties } from "react";
import type { Strings } from "../../i18n/strings";
import { Tooltip } from "../../engine/controls/Tooltip";
import { SettingsGroup } from "../pages/SettingsGroup";
import { SettingRow } from "../sections/controls";
import { PAGE_PALETTES, SYNTAX_PALETTES } from "../../theme/workshop-palettes";
import type { TypeChoices } from "../../theme/theme-typography";

interface Swatch {
  id: string;
  name: string;
  /** The swatch's own colours, as custom properties its CSS reads. */
  style: CSSProperties;
}

/** One choice among swatches, "the theme's own" first: a radio group, one
 *  tab stop, the arrows moving through it. */
function Swatches({
  label,
  follow,
  swatches,
  value,
  onChange,
}: {
  label: string;
  follow: string;
  swatches: Swatch[];
  value: string;
  onChange: (id: string) => void;
}) {
  const all = [{ id: "", name: follow, style: {} }, ...swatches];
  const at = Math.max(
    0,
    all.findIndex((s) => s.id === value),
  );
  return (
    <div
      className="workshop-swatches"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        const by =
          e.key === "ArrowRight" || e.key === "ArrowDown"
            ? 1
            : e.key === "ArrowLeft" || e.key === "ArrowUp"
              ? -1
              : 0;
        if (!by) return;
        e.preventDefault();
        const next = all[(at + by + all.length) % all.length];
        onChange(next.id);
        e.currentTarget
          .querySelector<HTMLElement>(`[data-swatch="${next.id}"]`)
          ?.focus();
      }}
    >
      {all.map((swatch, i) => {
        const chosen = i === at;
        const button = (
          <button
            key={swatch.id}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={swatch.name}
            tabIndex={chosen ? 0 : -1}
            data-swatch={swatch.id}
            className={
              swatch.id ? "workshop-swatch" : "workshop-swatch is-follow"
            }
            style={swatch.style}
            onClick={() => onChange(swatch.id)}
          >
            {!swatch.id && swatch.name}
          </button>
        );
        return swatch.id ? (
          <Tooltip key={swatch.id} text={swatch.name} description={null}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}

/** The page's and the code's palettes, each the theme's own until one is
 *  picked. */
export function PaletteRows({
  t,
  choices,
  onChoice,
  dark,
}: {
  t: Strings;
  choices: TypeChoices;
  onChoice: (patch: Partial<TypeChoices>) => void;
  dark: boolean;
}) {
  const form = dark ? "dark" : "light";
  const pages: Swatch[] = PAGE_PALETTES.map((p) => ({
    id: p.id,
    name: t[p.nameKey] as string,
    style: {
      "--swatch-bg": p[form].bg,
      "--swatch-ink": p[form].text,
      "--swatch-mark": p[form].accent,
    } as CSSProperties,
  }));
  const code: Swatch[] = SYNTAX_PALETTES.map((p) => ({
    id: p.id,
    name: t[p.nameKey] as string,
    style: {
      "--swatch-bg": PAGE_PALETTES[0][form].codeBg,
      "--swatch-ink": p[form].keyword,
      "--swatch-mark": p[form].string,
      "--swatch-third": p[form].function,
    } as CSSProperties,
  }));
  return (
    <SettingsGroup title={t.workshopColourGroup}>
      <SettingRow label={t.workshopPagePalette}>
        <Swatches
          label={t.workshopPagePalette}
          follow={t.docFontAuto}
          swatches={pages}
          value={choices.palette}
          onChange={(palette) => onChoice({ palette })}
        />
      </SettingRow>
      <SettingRow label={t.workshopCodePalette}>
        <Swatches
          label={t.workshopCodePalette}
          follow={t.docFontAuto}
          swatches={code}
          value={choices.syntax}
          onChange={(syntax) => onChoice({ syntax })}
        />
      </SettingRow>
    </SettingsGroup>
  );
}
