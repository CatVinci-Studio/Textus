import type { SkillTexts } from "../builtin";

/** French. "Complétion" is the UI's word for inline completion: not a
 *  label. */
export default {
  proofread: {
    label: "Relire et corriger",
    hint: "Vérifie orthographe, ponctuation et nombres selon les normes de votre langue",
    aliases: ["relire", "coquilles"],
  },
  theme: {
    label: "Créer un thème",
    hint: "Écrit un thème pour l'éditeur d'après votre description, prêt à l'emploi",
    aliases: ["thème", "créer-thème"],
  },
  plugin: {
    label: "Créer une extension",
    hint: "Une petite extension Textus d’après votre description, prête à installer",
    aliases: ["extension", "module"],
  },
  skill: {
    label: "Créer une compétence",
    hint: "Enregistre une tâche répétée comme compétence appelée par /",
    aliases: ["créer-compétence", "nouvelle compétence"],
  },
} satisfies SkillTexts;
