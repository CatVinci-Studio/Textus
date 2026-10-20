import type { SkillTexts } from "../builtin";

/** Spanish. "Autocompletado" is the UI's word for inline completion: not a
 *  label. */
export default {
  "continue-story": {
    label: "Continuar la historia",
    hint: "Escribe la siguiente sección con tu voz, fiel a la biblioteca",
    aliases: ["continuar"],
  },
  describe: {
    label: "Describir personaje o escena",
    hint: "Añade detalles concretos y sensoriales a una persona, un lugar o una escena",
    aliases: ["describir"],
  },
  dialogue: {
    label: "Pulir diálogos",
    hint: "Corrige la puntuación y los incisos del diálogo según el idioma del documento",
    aliases: ["diálogo", "dialogo"],
  },
  "imitate-style": {
    label: "Imitar un estilo",
    hint: "Reescribe al estilo de un texto de muestra o de tu perfil de estilo",
    aliases: ["imitar"],
  },
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
  "change-tone": {
    label: "Cambiar el tono",
    hint: "Hazlo más formal, más llano, más cálido o más firme",
    aliases: ["tono"],
  },
  "de-ai": {
    label: "Quitar el tono de IA",
    hint: "Elimina las fórmulas típicas de la IA, o solo señálalas",
    aliases: ["tono-ia"],
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
  email: {
    label: "Redactar correo",
    hint: "Redacta o reorganiza un correo o una carta",
    aliases: ["correo", "carta"],
  },
  notice: {
    label: "Aviso o documento oficial",
    hint: "Redacta o corrige un aviso, un comunicado o un escrito oficial",
    aliases: ["aviso", "comunicado"],
  },
  minutes: {
    label: "Acta de reunión",
    hint: "Convierte tus notas en acuerdos y tareas",
    aliases: ["acta"],
  },
  "academic-polish": {
    label: "Pulido académico",
    hint: "Redacción académica formal y medida para artículos y propuestas, sin fórmulas vacías; citas intactas",
    aliases: ["académico", "academico", "propuesta", "subvención"],
  },
  "social-post": {
    label: "Publicación en redes",
    hint: "Escribe una publicación que respete los límites y normas de la plataforma",
    aliases: ["publicación", "post"],
  },
  headline: {
    label: "Titular o título",
    hint: "Escribe un título fiel al contenido y de la longitud adecuada",
    aliases: ["título", "titulo", "titular"],
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
} satisfies SkillTexts;
