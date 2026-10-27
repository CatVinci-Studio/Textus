import type { SkillTexts } from "../builtin";

/** Portuguese (Brazil). "Autocompletar" is the UI's word for inline
 *  completion: not a label. */
export default {
  expand: {
    label: "Expandir",
    hint: "Deixa um trecho mais completo sem acrescentar fatos",
    aliases: ["desenvolver"],
  },
  tighten: {
    label: "Enxugar",
    hint: "Corta o excesso de palavras e mantém todos os fatos",
    aliases: ["encurtar"],
  },
  translate: {
    label: "Traduzir e polir",
    hint: "Traduz para que o texto pareça escrito originalmente no idioma",
    aliases: ["traduzir"],
  },
  proofread: {
    label: "Revisar",
    hint: "Confere ortografia, pontuação e números segundo as normas do seu idioma",
    aliases: ["revisão", "revisao"],
  },
  continuity: {
    label: "Verificar continuidade",
    hint: "Encontra contradições com a biblioteca e com outros capítulos",
    aliases: ["continuidade"],
  },
  summarize: {
    label: "Resumir",
    hint: "Resume com fidelidade, no tamanho que você pedir",
    aliases: ["resumo"],
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
