import type { SkillTexts } from "../builtin";

/** Portuguese (Brazil). "Autocompletar" is the UI's word for inline
 *  completion: not a label. */
export default {
  proofread: {
    label: "Revisar",
    hint: "Confere ortografia, pontuação e números segundo as normas do seu idioma",
    aliases: ["revisão", "revisao"],
  },
  theme: {
    label: "Criar um tema",
    hint: "Escreve um tema para o editor a partir da sua descrição, pronto para usar",
    aliases: ["tema", "criar-tema"],
  },
  plugin: {
    label: "Criar um plugin",
    hint: "Um pequeno plugin do Textus a partir da sua descrição, pronto para instalar",
    aliases: ["plugin", "extensão"],
  },
  skill: {
    label: "Criar uma habilidade",
    hint: "Guarda uma tarefa repetida como habilidade chamada com /",
    aliases: ["criar-habilidade", "nova habilidade"],
  },
} satisfies SkillTexts;
