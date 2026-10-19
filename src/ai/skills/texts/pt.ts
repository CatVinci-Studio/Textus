import type { SkillTexts } from "../builtin";

/** Portuguese (Brazil). "Autocompletar" is the UI's word for inline
 *  completion: not a label. */
export default {
  "continue-story": {
    label: "Continuar a história",
    hint: "Escreve a próxima seção com a sua voz, coerente com a biblioteca",
    aliases: ["continuar"],
  },
  describe: {
    label: "Descrever personagem ou cena",
    hint: "Acrescenta detalhes concretos e sensoriais a uma pessoa, um lugar ou uma cena",
    aliases: ["descrever"],
  },
  dialogue: {
    label: "Polir diálogos",
    hint: "Corrige a pontuação e as falas do narrador nos diálogos, conforme o idioma do documento",
    aliases: ["diálogo", "dialogo"],
  },
  "imitate-style": {
    label: "Imitar um estilo",
    hint: "Reescreve no estilo de um texto de exemplo ou do seu perfil de estilo",
    aliases: ["imitar"],
  },
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
  "change-tone": {
    label: "Mudar o tom",
    hint: "Deixa o texto mais formal, mais simples, mais caloroso ou mais firme",
    aliases: ["tom"],
  },
  "de-ai": {
    label: "Tirar o tom de IA",
    hint: "Remove as fórmulas típicas de IA, ou só aponta onde estão",
    aliases: ["tom-ia"],
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
  email: {
    label: "Escrever e-mail",
    hint: "Redige ou reorganiza um e-mail ou uma carta",
    aliases: ["email", "e-mail"],
  },
  notice: {
    label: "Aviso ou documento oficial",
    hint: "Redige ou corrige um aviso, um comunicado ou um ofício",
    aliases: ["ofício", "oficio"],
  },
  minutes: {
    label: "Ata de reunião",
    hint: "Transforma anotações em decisões e tarefas",
    aliases: ["ata"],
  },
  "academic-polish": {
    label: "Revisão acadêmica",
    hint: "Linguagem acadêmica formal e cuidadosa, sem mexer nas citações",
    aliases: ["acadêmico", "academico"],
  },
  "social-post": {
    label: "Post para redes sociais",
    hint: "Escreve um post dentro dos limites e das regras da plataforma",
    aliases: ["post", "legenda"],
  },
  headline: {
    label: "Título",
    hint: "Cria um título fiel ao conteúdo e do tamanho certo",
    aliases: ["manchete"],
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
} satisfies SkillTexts;
