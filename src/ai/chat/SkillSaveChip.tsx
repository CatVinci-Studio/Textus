import { useState, type ReactNode } from "react";
import type { AgentMode } from "../../prefs/settings-values";
import type { Strings } from "../../i18n/strings";
import { explainError } from "../../utils/error-explain";
import { ModeChoice } from "./ModeChoice";
import {
  confirmedFor,
  SkillWarnings,
  warningsIn,
  type Confirming,
} from "./skill-warnings";

type SaveState =
  | { kind: "new" }
  | { kind: "saved" }
  | { kind: "failed"; why: string }
  | { kind: "confirm"; warnings: string[]; modes: AgentMode[] };

/** Saving a skill a reply wrote or offered, in the modes picked: once it
 *  needs a second look (`confirming`), the next save goes through. */
export function useSkillSave(t: Strings, initialModes: AgentMode[]) {
  const [modes, setModes] = useState(initialModes);
  const [state, setState] = useState<SaveState>({ kind: "new" });
  const confirming = confirmedFor(
    state.kind === "confirm" ? state : null,
    modes,
  );
  const run = (
    save: (modes: AgentMode[], confirmed: boolean) => Promise<unknown>,
  ) =>
    save(modes, confirming !== null).then(
      () => setState({ kind: "saved" }),
      (err: unknown) => {
        const warnings = warningsIn(err);
        setState(
          warnings
            ? { kind: "confirm", warnings, modes }
            : { kind: "failed", why: explainError(err, t) },
        );
      },
    );
  return { state, modes, setModes, confirming, run };
}

/** The chip a skill is saved from: its name (or what it was saved as), why
 *  it needs a look, the modes and the save buttons until it is saved. */
export function SkillSaveChip({
  t,
  title,
  description,
  note,
  save,
  actions,
  children,
  ...attrs
}: {
  t: Strings;
  title: ReactNode;
  description?: string;
  /** Said before any click. */
  note?: string | null;
  save: {
    state: SaveState;
    modes: AgentMode[];
    setModes: (modes: AgentMode[]) => void;
    confirming: Confirming | null;
  };
  actions: ReactNode;
  children?: ReactNode;
  role?: string;
  "data-skill"?: string;
}) {
  const { state, modes, setModes, confirming } = save;
  return (
    <div className="agent-memory-chip skill-offer-chip" {...attrs}>
      <span className="tx-clamp agent-memory-chip-text">{title}</span>
      {description && (
        <span className="skill-offer-description">{description}</span>
      )}
      {state.kind === "failed" && (
        <span className="skill-offer-description">{state.why}</span>
      )}
      {note && (
        <span className="skill-offer-description skill-offer-warning">
          {note}
        </span>
      )}
      <SkillWarnings t={t} confirming={confirming} />
      {state.kind !== "saved" && (
        <span className="agent-memory-chip-actions">
          <ModeChoice t={t} modes={modes} onChange={setModes} />
          {actions}
        </span>
      )}
      {children}
    </div>
  );
}
