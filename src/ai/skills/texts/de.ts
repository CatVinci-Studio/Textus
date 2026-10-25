import type { SkillTexts } from "../builtin";

/** German. „Vervollständigung" is the UI's word for inline completion: not a
 *  label. */
export default {
  expand: {
    label: "Ausbauen",
    hint: "Macht eine Passage ausführlicher, ohne Fakten hinzuzufügen",
    aliases: ["erweitern"],
  },
  tighten: {
    label: "Straffen",
    hint: "Streicht Füllwörter und behält jede Tatsache",
    aliases: ["kürzen", "kuerzen"],
  },
  translate: {
    label: "Übersetzen und glätten",
    hint: "Übersetzt so, dass es sich wie ein Originaltext liest",
    aliases: ["übersetzen", "uebersetzen"],
  },
  proofread: {
    label: "Korrektur lesen",
    hint: "Prüft Rechtschreibung, Zeichensetzung und Zahlen nach den Regeln deiner Sprache",
    aliases: ["korrektur", "korrigieren"],
  },
  continuity: {
    label: "Kontinuität prüfen",
    hint: "Findet Widersprüche zum Lexikon und zu anderen Kapiteln",
    aliases: ["widersprüche", "kontinuität"],
  },
  summarize: {
    label: "Zusammenfassen",
    hint: "Fasst getreu zusammen, in der gewünschten Länge",
    aliases: ["zusammenfassung"],
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
