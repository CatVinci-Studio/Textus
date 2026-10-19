import type { SkillTexts } from "../builtin";

/** French. "Complétion" is the UI's word for inline completion: not a
 *  label. */
export default {
  "continue-story": {
    label: "Continuer l'histoire",
    hint: "Écrit la suite dans votre voix, cohérente avec la bibliothèque",
    aliases: ["continuer", "suite"],
  },
  describe: {
    label: "Décrire un personnage ou un lieu",
    hint: "Ajoute des détails concrets et sensoriels à un personnage, un lieu ou une scène",
    aliases: ["décrire", "decrire"],
  },
  dialogue: {
    label: "Peaufiner les dialogues",
    hint: "Corrige la ponctuation et les incises des dialogues selon la langue du document",
    aliases: ["dialogues"],
  },
  "imitate-style": {
    label: "Imiter un style",
    hint: "Réécrit à la manière d'un extrait ou de votre profil de style",
    aliases: ["pastiche"],
  },
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
  "change-tone": {
    label: "Changer de ton",
    hint: "Rend le texte plus soutenu, plus simple, plus chaleureux ou plus ferme",
    aliases: ["ton"],
  },
  "de-ai": {
    label: "Retirer le ton IA",
    hint: "Supprime les tournures typiques de l'IA, ou se contente de les signaler",
    aliases: ["ton-ia"],
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
  email: {
    label: "Rédiger un courriel",
    hint: "Rédige ou restructure un courriel ou une lettre",
    aliases: ["courriel", "lettre", "mail"],
  },
  notice: {
    label: "Avis ou document officiel",
    hint: "Rédige ou corrige un avis, une note ou un courrier officiel",
    aliases: ["avis", "note"],
  },
  minutes: {
    label: "Compte rendu",
    hint: "Transforme des notes en décisions et en actions à mener",
    aliases: ["compte-rendu", "procès-verbal"],
  },
  "academic-polish": {
    label: "Style académique",
    hint: "Une formulation universitaire soutenue et nuancée, citations intactes",
    aliases: ["académique", "academique"],
  },
  "social-post": {
    label: "Publication réseaux sociaux",
    hint: "Écrit une publication adaptée aux limites et aux règles de la plateforme",
    aliases: ["publication", "post"],
  },
  headline: {
    label: "Titre",
    hint: "Propose un titre fidèle, de la bonne longueur",
    aliases: ["titrer"],
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
} satisfies SkillTexts;
