import type { SkillTexts } from "../builtin";

/** German. „Vervollständigung" is the UI's word for inline completion: not a
 *  label. */
export default {
  proofread: {
    label: "Korrektur lesen",
    hint: "Prüft Rechtschreibung, Zeichensetzung und Zahlen nach den Regeln deiner Sprache",
    aliases: ["korrektur", "korrigieren"],
  },
  theme: {
    label: "Design entwerfen",
    hint: "Schreibt ein Editor-Design nach deiner Beschreibung, sofort nutzbar",
    aliases: ["design", "farbschema"],
  },
  plugin: {
    label: "Plugin bauen",
    hint: "Ein kleines Textus-Plugin nach deiner Beschreibung, bereit zum Installieren",
    aliases: ["plugin", "erweiterung"],
  },
  skill: {
    label: "Fähigkeit erstellen",
    hint: "Speichert eine wiederkehrende Aufgabe als Fähigkeit, die du mit / aufrufst",
    aliases: ["fähigkeit-erstellen", "neue fähigkeit"],
  },
} satisfies SkillTexts;
