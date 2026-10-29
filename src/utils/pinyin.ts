import tinyPinyin from "tiny-pinyin";

/**
 * Finding Chinese names by pinyin, as Chinese file managers and launchers
 * do: 背诵 by "beisong", "bs" or "beis". Readings come from the system's
 * Chinese collation (tiny-pinyin), which knows one per character.
 */

const HAN = /\p{Script=Han}/u;

/** Common characters read more than one way: the collation's one reading
 *  is often the other. */
const MORE_READINGS: Record<string, string[]> = {
  背: ["bei", "bao"],
  重: ["zhong", "chong"],
  行: ["xing", "hang"],
  长: ["chang", "zhang"],
  乐: ["le", "yue"],
  还: ["hai", "huan"],
  和: ["he", "huo", "hu"],
  得: ["de", "dei"],
  了: ["le", "liao"],
  的: ["de", "di"],
  着: ["zhe", "zhao", "zhuo"],
  都: ["dou", "du"],
  调: ["diao", "tiao"],
  传: ["chuan", "zhuan"],
  便: ["bian", "pian"],
  差: ["cha", "chai", "ci"],
  朝: ["chao", "zhao"],
  角: ["jiao", "jue"],
  降: ["jiang", "xiang"],
  解: ["jie", "xie"],
  会: ["hui", "kuai"],
  曾: ["ceng", "zeng"],
  区: ["qu", "ou"],
  单: ["dan", "shan"],
  薄: ["bo", "bao"],
  藏: ["cang", "zang"],
  参: ["can", "shen"],
  省: ["sheng", "xing"],
  率: ["lv", "shuai"],
  系: ["xi", "ji"],
  校: ["xiao", "jiao"],
  盛: ["sheng", "cheng"],
  属: ["shu", "zhu"],
  给: ["gei", "ji"],
  数: ["shu", "shuo"],
  地: ["di", "de"],
  大: ["da", "dai"],
  绿: ["lv", "lu"],
  女: ["nv", "nu"],
  吕: ["lv", "lu"],
};

/** Each character's readings in lower case, a character that isn't Han
 *  standing for itself; null for text without Han, or where the system
 *  can't tell. */
export function readings(text: string): string[][] | null {
  if (!HAN.test(text) || !tinyPinyin.isSupported()) return null;
  return tinyPinyin.parse(text).map((token) => {
    if (token.type !== 2) return [token.source.toLowerCase()];
    const read = token.target.toLowerCase();
    const more = MORE_READINGS[token.source] ?? [];
    return more.includes(read) ? more : [read, ...more];
  });
}

/**
 * Where `query` starts in `chars`, typed as consecutive characters'
 * readings - each in full or by its first letter, the last one perhaps
 * only begun - or -1.
 */
export function pinyinIndexOf(chars: string[][], query: string): number {
  const q = query.replace(/\s+/g, "");
  if (!q) return -1;
  const width = q.length + 1;
  const failed = new Set<number>();
  const from = (i: number, j: number): boolean => {
    if (j === q.length) return true;
    if (i === chars.length || failed.has(i * width + j)) return false;
    const rest = q.slice(j);
    for (const read of chars[i]) {
      if (read.startsWith(rest)) return true;
      if (rest.startsWith(read) && from(i + 1, j + read.length)) return true;
      if (read.length > 1 && rest[0] === read[0] && from(i + 1, j + 1))
        return true;
    }
    failed.add(i * width + j);
    return false;
  };
  for (let start = 0; start < chars.length; start++)
    if (from(start, 0)) return start;
  return -1;
}

/** A query that may be pinyin: Latin letters (and spaces) only. */
export function mayBePinyin(query: string): boolean {
  return /^[a-z][a-z\s]*$/i.test(query.trim());
}
