import type { SkillTexts } from "../builtin";

/** Spanish. "Autocompletado" is the UI's word for inline completion: not a
 *  label. */
export default {
  proofread: {
    label: "Corregir",
    hint: "Revisa ortografía, puntuación y cifras según las normas de tu idioma",
    aliases: ["revisar"],
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
