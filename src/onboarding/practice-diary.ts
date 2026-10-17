import type { Lang } from "../i18n/strings";

/**
 * The tour's practice document: a travel diary, written as the learner's
 * own, so that what the AI changes is their writing - never a classic's.
 * Each part has a job: the day headings make an outline, the second day
 * carries one small slip for the grammar lesson, and the flat third day is
 * the paragraph that gains from a revision. It ends the document, which is
 * where completion offers to go on.
 */
export interface PracticeDiary {
  /** The level-one heading the WYSIWYG lesson has the learner type. */
  title: string;
  /** Everything under it. No level-one heading, list or table of its own:
   *  those are what the writing lessons ask for. */
  body: string;
  /** A passage around the slip, unique in the diary: the grammar lesson
   *  checks the paragraph holding it. */
  slip: string;
}

const EN: PracticeDiary = {
  title: "Three days in Kyoto",
  body: `## Day one: Fushimi Inari

We left the hotel at six, while the gates at the foot of the hill were still quiet. The red torii climbed the mountain one after another, as if they would never end. Halfway up we turned around and watched the city slowly wake.

## Day two: Arashiyama

The wind was loud in the bamboo grove. We rented bikes and rode along the river to the Togetsukyo Bridge. By the afternoon we was too tired to go any further, so we sat by the water for an hour.

## Day three: Gion

It rained a little today. I walked down Hanamikoji Street. Then I went to a small café. The café was quiet. The coffee was good. I sat there for a long time. Then I went back to the hotel.
`,
  slip: "we was too tired",
};

const ZH: PracticeDiary = {
  title: "京都三日",
  body: `## 第一天：伏见稻荷

早上六点就出了门，山脚下的鸟居还很安静。红色的鸟居一座接着一座往山上延伸，好像永远走不到头。爬到半山腰，回头就能看见整座城市慢慢醒过来。

## 第二天：岚山

竹林里的风很大。我们租了自行车，沿着河一路骑到渡月桥。到了下午，我们已经走的很累了，就在河边坐了一个小时。

## 第三天：祇园

今天下了一点雨。我在花见小路走了走。然后去了一家小咖啡店。咖啡店很安静。咖啡很好喝。我在那里坐了很久。然后我就回酒店了。
`,
  slip: "已经走的很累了",
};

/** The diary in the UI's language; English where it hasn't been written
 *  in that one (the UI around it is still translated). */
export function practiceDiary(lang: Lang): PracticeDiary {
  return lang === "zh" ? ZH : EN;
}

/** Each diary's first heading: if one is in the document, the diary is. */
const MARKERS = [EN, ZH].map((diary) => diary.body.split("\n")[0].slice(3));

/**
 * The practice document with the diary in it. What the learner wrote in
 * the first lesson stays on top, the diary goes under it; an empty
 * document gets the diary's own title too. Already there (in any
 * language), the document is returned as it is.
 */
export function withPracticeDiary(
  markdown: string,
  diary: PracticeDiary,
): string {
  if (MARKERS.some((marker) => markdown.includes(marker))) return markdown;
  const own = markdown.trim();
  return own
    ? `${markdown.trimEnd()}\n\n${diary.body}`
    : `# ${diary.title}\n\n${diary.body}`;
}
