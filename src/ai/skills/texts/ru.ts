import type { SkillTexts } from "../builtin";

/** Russian. «Автодополнение» is the UI's word for inline completion: not a
 *  label. */
export default {
  proofread: {
    label: "Вычитать",
    hint: "Проверяет орфографию, пунктуацию и числа по нормам вашего языка",
    aliases: ["корректура"],
  },
  theme: {
    label: "Создать тему",
    hint: "Пишет тему редактора по вашему описанию, готовую к использованию",
    aliases: ["тема", "оформление"],
  },
  plugin: {
    label: "Сделать плагин",
    hint: "Небольшой плагин для Textus по вашему описанию, готовый к установке",
    aliases: ["плагин", "расширение"],
  },
  skill: {
    label: "Создать навык",
    hint: "Сохраняет повторяющуюся задачу как навык, вызываемый через /",
    aliases: ["создать-навык", "новый навык"],
  },
} satisfies SkillTexts;
