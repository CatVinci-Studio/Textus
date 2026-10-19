import type { SkillTexts } from "../builtin";

/** German. „Vervollständigung" is the UI's word for inline completion: not a
 *  label. */
export default {
  "continue-story": {
    label: "Geschichte fortsetzen",
    hint: "Schreibt den nächsten Abschnitt in deinem Ton, passend zum Lexikon",
    aliases: ["fortsetzen", "weiterschreiben"],
  },
  describe: {
    label: "Figur oder Szene beschreiben",
    hint: "Fügt einer Figur, einem Ort oder einer Szene konkrete, sinnliche Details hinzu",
    aliases: ["beschreiben"],
  },
  dialogue: {
    label: "Dialoge überarbeiten",
    hint: "Korrigiert Zeichensetzung und Begleitsätze in Dialogen nach der Sprache des Dokuments",
    aliases: ["dialog"],
  },
  "imitate-style": {
    label: "Stil nachahmen",
    hint: "Schreibt im Stil einer Textprobe oder deines Stilprofils um",
    aliases: ["stil"],
  },
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
  "change-tone": {
    label: "Ton ändern",
    hint: "Macht den Text förmlicher, schlichter, wärmer oder bestimmter",
    aliases: ["ton"],
  },
  "de-ai": {
    label: "KI-Ton entfernen",
    hint: "Entfernt typische KI-Floskeln oder markiert sie nur",
    aliases: ["ki-ton"],
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
  email: {
    label: "E-Mail schreiben",
    hint: "Entwirft oder gliedert eine E-Mail oder einen Brief",
    aliases: ["email", "e-mail", "brief"],
  },
  notice: {
    label: "Bekanntmachung oder Amtsschreiben",
    hint: "Entwirft oder überarbeitet eine Bekanntmachung oder ein amtliches Schreiben",
    aliases: ["bekanntmachung", "aushang"],
  },
  minutes: {
    label: "Protokoll",
    hint: "Macht aus Notizen Beschlüsse und Aufgaben",
    aliases: [],
  },
  "academic-polish": {
    label: "Wissenschaftlich überarbeiten",
    hint: "Förmliche, abgewogene Wissenschaftssprache, Zitate bleiben unberührt",
    aliases: ["wissenschaftlich"],
  },
  "social-post": {
    label: "Social-Media-Beitrag",
    hint: "Schreibt einen Beitrag, der zu den Limits und Regeln der Plattform passt",
    aliases: ["beitrag", "post"],
  },
  headline: {
    label: "Überschrift",
    hint: "Findet einen treffenden Titel in der richtigen Länge",
    aliases: ["titel"],
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
} satisfies SkillTexts;
