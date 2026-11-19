import { useState } from "react";
import { usePhoneLayout } from "./usePhoneLayout";
import { useSettings } from "../../prefs/SettingsContext";
import { BottomCard } from "./BottomCard";
import { Presence } from "../motion/usePresence";
import "./ColorField.css";

/** The palette's tones, in their fixed order (theme tokens). */
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

const HEX = /^#[0-9a-f]{6}$/i;

interface ColorFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}

/** A colour setting: the system's picker on a computer or a tablet; on a
 *  phone the app's own card, the palette's tones and a hex field. */
export function ColorField(props: ColorFieldProps) {
  const phone = usePhoneLayout();
  if (!phone)
    return (
      <input
        className={props.className}
        aria-label={props.label}
        type="color"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    );
  return <TouchColorField {...props} />;
}

/** The tones as the theme has them now, as hex: a theme's own wins. */
function toneValues(): string[] {
  const style = getComputedStyle(document.documentElement);
  return TONES.map((tone) =>
    style.getPropertyValue(`--tone-${tone}`).trim(),
  ).filter((v) => HEX.test(v));
}

function TouchColorField({
  value,
  onChange,
  label,
  className,
}: ColorFieldProps) {
  const { t } = useSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const choose = (next: string) => {
    if (HEX.test(next)) onChange(next.toLowerCase());
  };
  return (
    <>
      <button
        type="button"
        className={`color-swatch-button ${className ?? ""}`}
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => setDraft(value)}
      >
        <span className="color-swatch" style={{ background: value }} />
      </button>
      <Presence show={draft !== null}>
        {draft !== null && (
          <BottomCard
            label={label}
            onClose={() => setDraft(null)}
            actions={[
              { label: t.cancel, onSelect: () => {} },
              {
                label: t.dialogOk,
                onSelect: () => choose(draft),
                primary: true,
              },
            ]}
          >
            <div className="color-tones" role="radiogroup" aria-label={label}>
              {toneValues().map((tone) => (
                <button
                  key={tone}
                  type="button"
                  role="radio"
                  aria-checked={tone.toLowerCase() === draft.toLowerCase()}
                  aria-label={tone}
                  className="color-tone"
                  style={{ background: tone }}
                  onClick={() => setDraft(tone)}
                />
              ))}
            </div>
            <input
              className="tx-input settings-text-input color-hex"
              aria-label={label}
              value={draft}
              aria-invalid={!HEX.test(draft)}
              spellCheck={false}
              autoCapitalize="off"
              onChange={(e) => setDraft(e.target.value.trim())}
            />
          </BottomCard>
        )}
      </Presence>
    </>
  );
}
