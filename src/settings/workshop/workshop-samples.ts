// Generated from the website's classics (website/site/content/classics):
// one public-domain work per UI language, its text checked against the
// primary sources there. The workshop shows the page in the reader's
// language: its script, its punctuation, its fonts. The ideographic
// spaces in chapter titles are the originals', written \u3000 for the linter.
import type { Lang } from "../../i18n/langs";

/** Each language's sample page: headings, marks, lists, a quote, code, a
 *  table and a formula. */
export const WORKSHOP_SAMPLES: Record<Lang, string> = {
  en: `# Hamlet

To die—to sleep,
No more; and by a sleep to say we end
The heart-ache, and the thousand natural shocks
That flesh is heir to.

## Act III, Scene I

**O, what a noble mind is here o’erthrown!** The *courtier’s, soldier’s, scholar’s*, eye, tongue, sword, Th’expectancy and ==rose of the fair state==, The glass of fashion and ~~the mould of form~~, [Th’observ’d of all observers](#), quite, quite down!

- HAMLET, Prince of Denmark
- OPHELIA, Daughter to Polonius
- HORATIO, Friend to Hamlet

> To be, or not to be, that is the question: / Whether ’tis nobler in the mind to suffer / The slings and arrows of outrageous fortune,

### Contents

1. Scene I. A room in the Castle
2. Scene II. A hall in the Castle
3. Scene III. A room in the Castle

\`\`\`js
function measure(text, width) {
  return Math.round(width / text.length);
}
\`\`\`

| Act | Words | Done |
| --- | --- | --- |
| I | 6998 | ✓ |
| II | 5915 | ✓ |
| III | 7562 | … |

$$
E = mc^2, \\quad \\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
`,
  zh: `# 红楼梦

且说黛玉自那日弃舟登岸时，便有荣国府打发了轿子并拉行李的车辆久候了。

## 第三回\u3000金陵城起复贾雨村\u3000荣国府收养林黛玉

厮见毕归坐，细看形容，与众各别：**两湾似蹙非蹙罥烟眉**，*一双似泣非泣含露目*。==态生两靥之愁==，娇袭一身之病。~~泪光点点~~，娇喘微微。[闲静时如姣花照水](#)，行动处似弱柳扶风。

- 林黛玉
- 贾宝玉
- 王熙凤

> 满纸荒唐言，一把辛酸泪！
> 都云作者痴，谁解其中味？

### 目录

1. 甄士隐梦幻识通灵\u3000贾雨村风尘怀闺秀
2. 贾夫人仙逝扬州城\u3000冷子兴演说荣国府
3. 金陵城起复贾雨村\u3000荣国府收养林黛玉

\`\`\`js
function measure(text, width) {
  return Math.round(width / text.length);
}
\`\`\`

| 回 | 字数 | 完成 |
| --- | --- | --- |
| 第一回 | 6288 | ✓ |
| 第二回 | 5043 | ✓ |
| 第三回 | 7243 | … |

$$
E = mc^2, \\quad \\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
`,
  "zh-Hant": `# 西遊記

那座山正當頂上，有一塊仙石。其石有三丈六尺五寸高，有二丈四尺圍圓。

## 第一回\u3000靈根育孕源流出\u3000心性修持大道生

國近大海，海中有一座名山，喚為**花果山**。此山乃*十洲之祖脈*，==三島之來龍==，自開清濁而立，~~鴻濛判後而成~~。[真個好山](#)！

- 孫悟空
- 須菩提祖師
- 東海龍王敖廣

> 混沌未分天地亂，茫茫渺渺無人見。
> 自從盤古破鴻濛，開闢從茲清濁辨。

### 目錄

1. 靈根育孕源流出\u3000心性修持大道生
2. 悟徹菩提真妙理\u3000斷魔歸本合元神
3. 四海千山皆拱伏\u3000九幽十類盡除名

\`\`\`js
function measure(text, width) {
  return Math.round(width / text.length);
}
\`\`\`

| 章回 | 字數 | 完成 |
| --- | --- | --- |
| 第一回 | 5630 | ✓ |
| 第二回 | 5660 | ✓ |
| 第三回 | 5725 | … |

$$
E = mc^2, \\quad \\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
`,
  ja: `# 吾輩は猫である

吾輩は猫である。名前はまだ無い。

## 一

**第一毛をもって装飾されべきはずの顔**が*つるつるして*まるで==薬缶==だ。その後猫にもだいぶ逢ったがこんな片輪には一度も出会わした事がない。のみならず~~顔の真中があまりに突起している~~。[そうしてその穴の中から時々ぷうぷうと煙を吹く](#)。

- 吾輩
- 苦沙弥
- 迷亭

> 今日は上天気の日曜なので、主人はのそのそ書斎から出て来て、吾輩の傍へ筆硯と原稿用紙を並べて腹這になって、しきりに何か唸っている。

### 書き出し

1. 吾輩は猫である。名前はまだ無い。
2. 吾輩は新年来多少有名になったので、猫ながらちょっと鼻が高く感ぜらるるのはありがたい。
3. 三毛子は死ぬ。

\`\`\`js
function measure(text, width) {
  return Math.round(width / text.length);
}
\`\`\`

| 章 | 文字数 | 校了 |
| --- | --- | --- |
| 一 | 11122 | ✓ |
| 二 | 37408 | ✓ |
| 三 | 31953 | … |

$$
E = mc^2, \\quad \\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
`,
  ko: `# 메밀꽃 필 무렵

이지러는 졌으나 보름을 갓 지난 달은 부드러운 빛을 흔붓이 흘리고 있다.

## 이효석

**여름장이란 애시당초에 글러서**, 해는 아직 *중천*에 있건만 ==장판은 벌써 쓸쓸하고== 더운 햇발이 벌여놓은 전 휘장 밑으로 ~~등줄기를~~ [훅훅 볶는다](#).

- 허 생원
- 조 선달
- 동이

> 산허리는 온통 메밀 밭이어서 피기 시작한 꽃이 소금을 뿌린 듯이 흐붓한 달빛에 숨이 막힐 지경이다.

### 약바르게 떠나는 패도 있었다.

1. 어물장수
2. 땜장이
3. 엿장수
4. 생강장수

\`\`\`js
function measure(text, width) {
  return Math.round(width / text.length);
}
\`\`\`

| 인물 | 등장 횟수 | 왼손잡이 |
| --- | --- | --- |
| 허 생원 | 20 | ✓ |
| 동이 | 20 | ✓ |
| 조 선달 | 9 | — |

$$
E = mc^2, \\quad \\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
`,
  es: `# Don Quijote de la Mancha

En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor.

## Capítulo primero

En un lugar de **la Mancha**, *de cuyo nombre no quiero acordarme*, no ha mucho tiempo que vivía un ==hidalgo== de los de lanza en astillero, ~~adarga antigua~~, [rocín flaco](#) y galgo corredor.

- don Quijote
- Sancho Panza
- Dulcinea del Toboso

> Muchas veces tomé la pluma para escribille, y muchas la dejé, por no saber lo que escribiría.

### Una olla de algo más vaca que carnero

1. salpicón las más noches
2. duelos y quebrantos los sábados
3. lantejas los viernes
4. algún palomino de añadidura los domingos

\`\`\`js
function measure(text, width) {
  return Math.round(width / text.length);
}
\`\`\`

| Capítulo | Palabras | Hecho |
| --- | --- | --- |
| Primero | 1895 | ✓ |
| II | 2223 | ✓ |
| III | 2332 | … |

$$
E = mc^2, \\quad \\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
`,
  fr: `# Les Misérables

En 1815, M. Charles-François-Bienvenu Myriel était évêque de Digne. C’était un vieillard d’environ soixante-quinze ans ; il occupait le siège de Digne depuis 1806.

## Livre premier — Un juste

En 1815, M. **Charles-François-Bienvenu Myriel** était *évêque de Digne*. C’était ==un vieillard== d’environ soixante-quinze ans ; il occupait ~~le siège de Digne~~ depuis [1806](#).

- Monseigneur Bienvenu
- Mademoiselle Baptistine
- Madame Magloire

> Vrai ou faux, ce qu’on dit des hommes tient souvent autant de place dans leur vie et surtout dans leur destinée que ce qu’ils font.

### Table des matières

1. Monsieur Myriel
2. Monsieur Myriel devient monseigneur Bienvenu
3. À bon évêque dur évêché

\`\`\`js
function measure(text, width) {
  return Math.round(width / text.length);
}
\`\`\`

| Chapitre | Mots | Fait |
| --- | --- | --- |
| I | 963 | ✓ |
| II | 1619 | ✓ |
| III | 730 | … |

$$
E = mc^2, \\quad \\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
`,
  de: `# Die Verwandlung

Als Gregor Samsa eines Morgens aus unruhigen Träumen erwachte, fand er sich in seinem Bett zu einem ungeheueren Ungeziefer verwandelt.

## I.

**Gregors Blick** richtete sich dann *zum Fenster*, und ==das trübe Wetter== – man hörte Regentropfen auf ~~das Fensterblech~~ aufschlagen – machte ihn [ganz melancholisch](#).

- Gregor Samsa
- Grete
- der Prokurist

> »Was ist mit mir geschehen?« dachte er. Es war kein Traum.

### Diese Plage des Reisens

1. die Sorgen um die Zuganschlüsse
2. das unregelmäßige, schlechte Essen
3. ein immer wechselnder, nie andauernder, nie herzlich werdender menschlicher Verkehr

\`\`\`js
function measure(text, width) {
  return Math.round(width / text.length);
}
\`\`\`

| Teil | Wörter | Fertig |
| --- | --- | --- |
| I. | 6105 | ✓ |
| II. | 6664 | ✓ |
| III. | 6382 | … |

$$
E = mc^2, \\quad \\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
`,
  ru: `# Анна Каренина

Все смешалось в доме Облонских. Жена узнала, что муж был в связи с бывшею в их доме француженкою-гувернанткой, и объявила мужу, что не может жить с ним в одном доме.

## Часть первая

На третий день после ссоры **князь Степан Аркадьич Облонский** — *Стива, как его звали в свете*, — в обычный час, то есть ==в восемь часов утра==, проснулся не в спальне жены, а ~~в своем кабинете~~, [на сафьянном диване](#).

- Степан Аркадьич Облонский
- Долли
- Матвей

> Все счастливые семьи похожи друг на друга, каждая несчастливая семья несчастлива по-своему.

### Все смешалось в доме Облонских.

1. Жена не выходила из своих комнат
2. мужа третий день не было дома
3. Дети бегали по всему дому, как потерянные

\`\`\`js
function measure(text, width) {
  return Math.round(width / text.length);
}
\`\`\`

| Глава | Слов | Готово |
| --- | --- | --- |
| I | 703 | ✓ |
| II | 927 | ✓ |
| III | 1247 | … |

$$
E = mc^2, \\quad \\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
`,
  pt: `# Dom Casmurro

Uma noite destas, vindo da cidade para o Engenho Novo, encontrei no trem da Central um rapaz aqui do bairro, que eu conheço de vista e de chapéo.

## I. Do título

**Não consultes dicionários.** *Casmurro* não está aqui ==no sentido que eles lhe dão==, mas no que lhe pôs o vulgo de ~~homem calado~~ e [metido consigo](#).

- Bentinho
- Capitu
- José Dias

> Agora que expliquei o título, passo a escrever o livro.

### Índice

1. Do título
2. Do livro
3. A denúncia

\`\`\`js
function measure(text, width) {
  return Math.round(width / text.length);
}
\`\`\`

| Capítulo | Palavras | Feito |
| --- | --- | --- |
| I | 336 | ✓ |
| II | 729 | ✓ |
| III | 659 | … |

$$
E = mc^2, \\quad \\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
`,
};
