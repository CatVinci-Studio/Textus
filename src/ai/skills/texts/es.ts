import type { SkillTexts } from "../builtin";

/** Spanish. "Autocompletado" is the UI's word for inline completion: not a
 *  label. */
export default {
  expand: {
    label: "Ampliar",
    hint: "Da más cuerpo a un pasaje sin añadir datos",
    aliases: ["desarrollar"],
  },
  tighten: {
    label: "Condensar",
    hint: "Quita lo que sobra y conserva todos los datos",
    aliases: ["acortar"],
  },
  translate: {
    label: "Traducir y pulir",
    hint: "Traduce para que se lea como un texto escrito en ese idioma",
    aliases: ["traducir"],
  },
  proofread: {
    label: "Corregir",
    hint: "Revisa ortografía, puntuación y cifras según las normas de tu idioma",
    aliases: ["revisar"],
  },
  continuity: {
    label: "Revisar continuidad",
    hint: "Encuentra contradicciones con la biblioteca y otros capítulos",
    aliases: ["continuidad"],
  },
  summarize: {
    label: "Resumir",
    hint: "Resume con fidelidad, con la extensión que pidas",
    aliases: ["resumen"],
  },
  theme: {
    label: "Diseñar un tema",
    hint: "Escribe un tema para el editor según tu descripción, listo para usar",
    aliases: ["tema", "diseñar-tema"],
  },
  plugin: {
    label: "Crear un complemento",
    hint: "Un pequeño complemento de Textus según tu descripción, listo para instalar",
    aliases: ["complemento", "extensión"],
  },
  skill: {
    label: "Crear una habilidad",
    hint: "Guarda una tarea que repites como habilidad que llamas con /",
    aliases: ["crear-habilidad", "nueva habilidad"],
  },
} satisfies SkillTexts;
