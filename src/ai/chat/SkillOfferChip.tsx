import { fill } from "../../i18n/fill";
import { useState } from "react";
import { ai } from "../../platform/ipc";
import type { SkillOffer } from "../../platform/bindings/ai-memory";
import { useSettings } from "../../prefs/SettingsContext";
import type { AgentMode } from "../../prefs/settings-values";
import { ModeChoice } from "./ModeChoice";
import { explainError } from "../../utils/error-explain";
import { confirmedFor, SkillWarnings, warningsIn } from "./skill-warnings";

/** The call an offer stands in the conversation as. */
export const OFFER_SKILL = "offer_skill";

/** The offer a turn's output holds, or null. */
export function parseSkillOffer(output: string): SkillOffer | null {
  try {
    const o = JSON.parse(output);
    return typeof o?.name === "string" &&
      typeof o.description === "string" &&
      typeof o.instructions === "string"
      ? {
          name: o.name,
          description: o.description,
          instructions: o.instructions,
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * Under a reply whose request was a procedure of its own: the offer to keep
 * it as a skill, and once saved, the /name it goes by.
 */
export function SkillOfferChip({
  offer,
  docPath,
}: {
  offer: SkillOffer;
  /** The conversation's document: its project folder is where a
   *  project's skill goes. */
  docPath: string | null;
}) {
  const { settings, t } = useSettings();
  const [modes, setModes] = useState<AgentMode[]>(["write"]);
  const [state, setState] = useState<
    | { kind: "offered" }
    | { kind: "saved" }
    | { kind: "failed"; why: string }
    | { kind: "confirm"; warnings: string[]; modes: AgentMode[] }
  >({ kind: "offered" });
  const confirming = confirmedFor(
    state.kind === "confirm" ? state : null,
    modes,
  );
  const save = (scope: "personal" | "project") => {
    ai.saveOfferedSkill(
      offer,
      scope,
      docPath,
      settings.agentWorkspaceRoot || null,
      modes,
      !!confirming,
    ).then(
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
  };
  return (
    <div className="agent-memory-chip skill-offer-chip" role="status">
      <span className="tx-clamp agent-memory-chip-text">
        {state.kind === "saved"
          ? fill(t.skillOfferSaved, { name: `/${offer.name}` })
          : fill(t.skillOffer, { name: `/${offer.name}` })}
      </span>
      <span className="skill-offer-description">{offer.description}</span>
      {state.kind === "failed" && (
        <span className="skill-offer-description">{state.why}</span>
      )}
      <SkillWarnings t={t} confirming={confirming} />
      {state.kind !== "saved" && (
        <span className="agent-memory-chip-actions">
          <ModeChoice t={t} modes={modes} onChange={setModes} />
          <button type="button" onClick={() => save("personal")}>
            {confirming ? t.skillSaveAnyway : t.skillOfferSave}
          </button>
          {docPath && (
            <button type="button" onClick={() => save("project")}>
              {t.skillOfferSaveProject}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
