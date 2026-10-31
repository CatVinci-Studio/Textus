import type { Lang } from "../i18n/strings";

/**
 * The tour's practice document: a short public-domain excerpt quoted
 * verbatim, then the learner's own wordy notes. AI lessons only ever rework
 * the notes, never the classic.
 */
export interface PracticeNotes {
  /** The level-one heading the WYSIWYG lesson has the learner type. */
  title: string;
  /** Everything under it. No level-one heading, list, table, inline mark or
   *  link of its own: those are what the writing lessons ask the learner to add. */
  body: string;
}

const NOTES: Record<Lang, PracticeNotes> = {
  en: {
    title: "Notes on Hamlet",
    body: `## Act III, Scene 1

> To be, or not to be, that is the question:\\
> Whether ’tis nobler in the mind to suffer\\
> The slings and arrows of outrageous fortune,\\
> Or to take arms against a sea of troubles,\\
> And by opposing end them?

## My notes

Hamlet's question is not really only about whether to live or to die, if you think about it.

In the end, it seems to be the fear of what might come after death that is the thing that keeps him from acting.
`,
  },
  zh: {
    title: "《红楼梦》读书笔记",
    body: `## 第三回（节选）

> 黛玉一见，便吃一大惊，心下想道：“好生奇怪，倒象在那里见过一般，何等眼熟到如此！”

> 宝玉看罢，因笑道：“这个妹妹我曾见过的。”贾母笑道：“可又是胡说，你又何曾见过他？”

## 我的笔记

这一句其实是在呼应第一回的前世姻缘，可以说是全书爱情线的一个起点。

宝玉初见黛玉便觉似曾相识，作者就某种意义而言是借这句话点明了木石前盟。
`,
  },
  "zh-Hant": {
    title: "《西遊記》讀書筆記",
    body: `## 第一回（節選）

> 那座山正當頂上，有一塊仙石。其石有三丈六尺五寸高，有二丈四尺圍圓。

> 內育仙胞，一日迸裂，產一石卵，似圓毬樣大。因見風，化作一個石猴，五官俱備，四肢皆全。

## 我的筆記

這一段其實是在交代石猴的來歷，可以說是全書故事的一個起點。

就某種意義而言，孫悟空天生就帶著天地的氣數，這也就是他後來敢大鬧天宮的一個伏筆。
`,
  },
  ja: {
    title: "『吾輩は猫である』読書ノート",
    body: `## 一（抜粋）

> 吾輩は猫である。名前はまだ無い。

> どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。

## わたしのノート

この冒頭は、ある意味では、猫が語り手であるということをいきなり読者に宣言している書き出しだと言えるのではないかと思う。

そういった意味で、人間を外から眺めるという、この作品全体の視点がここで決まっているのだと言えるだろう。
`,
  },
  ko: {
    title: "메밀꽃 필 무렵 독서 노트",
    body: `## 본문에서

> 이지러는 졌으나 보름을 갓 지난 달은 부드러운 빛을 흔붓이 흘리고 있다.

> 산허리는 온통 메밀 밭이어서 피기 시작한 꽃이 소금을 뿌린 듯이 흐붓한 달빛에 숨이 막힐 지경이다.

## 나의 노트

이 대목은 사실 소설 전체에서 가장 유명한 부분이라고 할 수 있을 것 같다.

어떤 의미에서 보면, 이 풍경이 허 생원으로 하여금 그날 밤의 추억을 털어놓게 만드는 일종의 계기가 되는 것이라고 볼 수 있다.
`,
  },
  es: {
    title: "Notas sobre el Quijote",
    body: `## Capítulo primero

> En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor.

## Mis notas

En realidad, el comienzo es, por así decirlo, un retrato del hidalgo hecho con sus pocas posesiones.

Podría decirse que lo conocemos por lo que tiene antes que por lo que hace.
`,
  },
  fr: {
    title: "Notes sur Les Misérables",
    body: `## Livre premier

> En 1815, M. Charles-François-Bienvenu Myriel était évêque de Digne.

> Vrai ou faux, ce qu’on dit des hommes tient souvent autant de place dans leur vie et surtout dans leur destinée que ce qu’ils font.

## Mes notes

En fait, Hugo ouvre son roman, pour ainsi dire, sur un évêque et non sur Valjean.

On pourrait dire que toute l’histoire commence par une réputation.
`,
  },
  de: {
    title: "Notizen zur Verwandlung",
    body: `## Kapitel I

> Als Gregor Samsa eines Morgens aus unruhigen Träumen erwachte, fand er sich in seinem Bett zu einem ungeheueren Ungeziefer verwandelt.

## Meine Notizen

Eigentlich ist der erste Satz gewissermaßen schon die ganze Erzählung.

Im Grunde geht es also gar nicht um das Warum, sondern um das Weiterleben.
`,
  },
  ru: {
    title: "Заметки: Анна Каренина",
    body: `## Часть первая, глава I

> Все счастливые семьи похожи друг на друга, каждая несчастливая семья несчастлива по-своему.

## Мои заметки

На самом деле первая фраза, можно сказать, своего рода вывод, сделанный заранее.

Как мне кажется, весь роман и есть проверка этой фразы.
`,
  },
  pt: {
    title: "Notas sobre Dom Casmurro",
    body: `## Capítulo I. Do título

> Uma noite destas, vindo da cidade para o Engenho Novo, encontrei no trem da Central um rapaz aqui do bairro, que eu conheço de vista e de chapéo.

## Minhas notas

Na verdade, o capítulo que abre o livro é, por assim dizer, uma espécie de piada sobre o próprio título.

De certa forma, poderíamos dizer que já aqui ele se mostra como alguém que conta a história do seu jeito.
`,
  },
};

export function practiceNotes(lang: Lang): PracticeNotes {
  return NOTES[lang];
}

/** Each language's first heading: if one is in the document, its notes
 *  are. */
const MARKERS = Object.values(NOTES).map((notes) =>
  notes.body.split("\n")[0].slice(3),
);

/** The practice document with the notes under what the learner wrote; an
 *  empty one gets their title too. Already there, it is returned as is. */
export function withPracticeNotes(
  markdown: string,
  notes: PracticeNotes,
): string {
  if (MARKERS.some((marker) => markdown.includes(marker))) return markdown;
  const own = markdown.trim();
  return own
    ? `${markdown.trimEnd()}\n\n${notes.body}`
    : `# ${notes.title}\n\n${notes.body}`;
}
