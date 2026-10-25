import type { SkillTexts } from "../builtin";

/** French. "Complétion" is the UI's word for inline completion: not a
 *  label. */
export default {
  expand: {
    label: "Développer",
    hint: "Étoffe un passage sans ajouter de faits",
    aliases: ["étoffer", "etoffer"],
  },
  tighten: {
    label: "Resserrer",
    hint: "Supprime les longueurs et garde tous les faits",
    aliases: ["raccourcir"],
  },
  translate: {
    label: "Traduire et peaufiner",
    hint: "Traduit pour que le texte se lise comme s'il avait été écrit dans la langue",
    aliases: ["traduire"],
  },
  proofread: {
    label: "Relire et corriger",
    hint: "Vérifie orthographe, ponctuation et nombres selon les normes de votre langue",
    aliases: ["relire", "coquilles"],
  },
  continuity: {
    label: "Vérifier la cohérence",
    hint: "Repère les contradictions avec la bibliothèque et les autres chapitres",
    aliases: ["cohérence", "coherence"],
  },
  summarize: {
    label: "Résumer",
    hint: "Résume fidèlement, à la longueur demandée",
    aliases: ["résumé", "resume"],
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
