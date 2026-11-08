import { useState } from "react";
import { currentStrings } from "../../i18n/current";

/**
 * The form's date and colour fields (textus.ui.pickDate, pickColor, and
 * `date` / `color` in textus.ui.form), drawn with the shared controls a
 * plugin page has too (src/ui/controls.css).
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The month `value` is in, else this one. */
function monthOf(value: string): Date {
  const m = DAY.exec(value);
  const d = m ? new Date(+m[1], +m[2] - 1, 1) : new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** The 42 days a month's grid shows, Monday first. */
export function monthDays(month: Date): Date[] {
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function DateField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = currentStrings();
  const [month, setMonth] = useState(() => monthOf(value));
  const lang = document.documentElement.lang || undefined;
  const today = iso(new Date());
  const shift = (n: number) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const days = monthDays(month);
  return (
    <div className="plugin-form-date">
      <div className="tx-pager">
        <button
          type="button"
          className="tx-icon-button"
          aria-label={t.pluginFormPrevMonth}
          onClick={() => shift(-1)}
        >
          <span className="tx-icon" data-icon="left" />
        </button>
        <span className="tx-value" aria-live="polite">
          {new Intl.DateTimeFormat(lang, {
            year: "numeric",
            month: "long",
          }).format(month)}
        </span>
        <button
          type="button"
          className="tx-icon-button"
          aria-label={t.pluginFormNextMonth}
          onClick={() => shift(1)}
        >
          <span className="tx-icon" data-icon="right" />
        </button>
      </div>
      <div className="tx-calendar" role="grid">
        {days.slice(0, 7).map((d) => (
          <span key={d.getDay()} className="tx-calendar-weekday">
            {new Intl.DateTimeFormat(lang, { weekday: "narrow" }).format(d)}
          </span>
        ))}
        {days.map((d) => {
          const key = iso(d);
          const classes = [
            "tx-calendar-day",
            d.getMonth() !== month.getMonth() && "is-other",
            key === today && "is-today",
          ].filter(Boolean);
          return (
            <button
              key={key}
              type="button"
              className={classes.join(" ")}
              aria-selected={key === value}
              aria-label={key}
              onClick={() => onChange(key)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <input
        id={id}
        className="settings-text-input"
        value={value}
        placeholder="YYYY-MM-DD"
        inputMode="numeric"
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          if (DAY.test(e.target.value)) setMonth(monthOf(e.target.value));
        }}
      />
    </div>
  );
}

/** The tones in their order (design-language.md 3.4). */
const TONES = [
  "blue",
  "green",
  "orange",
  "purple",
  "red",
  "teal",
  "yellow",
  "pink",
  "gray",
];

/** A tone's colour in the theme now, as #rrggbb. */
function toneHex(tone: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(--tone-${tone})`;
  document.body.append(probe);
  const rgb = getComputedStyle(probe).color.match(/\d+/g) ?? ["0", "0", "0"];
  probe.remove();
  return (
    "#" +
    rgb
      .slice(0, 3)
      .map((n) => Number(n).toString(16).padStart(2, "0"))
      .join("")
  );
}

export function ColorField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [hexes] = useState(() => TONES.map(toneHex));
  return (
    <div className="plugin-form-color">
      <div className="plugin-form-swatches" role="radiogroup">
        {hexes.map((hex) => (
          <button
            key={hex}
            type="button"
            role="radio"
            className="plugin-form-swatch"
            style={{ background: hex }}
            aria-checked={hex === value.toLowerCase()}
            aria-label={hex}
            onClick={() => onChange(hex)}
          />
        ))}
      </div>
      <input
        id={id}
        className="settings-text-input"
        value={value}
        placeholder="#rrggbb"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
