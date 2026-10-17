import story from "./diary-story.json";

export interface StoryExchange {
  line: string;
  reply: string;
}
type StoryLanguage = "zh" | "zh-Hant" | "en";
const scenes = story.scenes.map((scene) => ({
  ...scene,
  match: new RegExp(scene.pattern, "i"),
}));
const continuation =
  /^(后来呢|後來呢|然后呢|然後呢|继续|繼續|接着说|接著說|再说一点|再說一點|好|好的|想|想知道|是的|想听|想聽|继续讲|continue|go on|and then|yes|tell me more)[!?？。.!\s]*$/i;

/** Curated lore stays available offline. Followups continue only a story
 * already being told, so an ordinary "yes" never starts a story by itself. */
export function storyReply(
  language: string,
  line: string,
  history: StoryExchange[] = [],
): string | null {
  if (language !== "zh" && language !== "zh-Hant" && language !== "en")
    return null;
  const lang: StoryLanguage = language;
  const input = line.normalize("NFKC").trim();
  const previous = history[history.length - 1]?.reply;
  const last = scenes.findIndex((scene) =>
    Object.values(scene.replies).includes(previous),
  );
  if (
    /原著|原作|正史|official|canon|true story/i.test(input) &&
    (/textus|薇拉|vela|未竟之城|unfinished city/i.test(input) || last >= 0)
  )
    return story.canon[lang];
  if (last >= 0 && /^(我在这里|我在這裡|i am here)[。.!！\s]*$/i.test(input))
    return scenes[scenes.length - 1].replies[lang];
  if (continuation.test(input))
    return last < 0
      ? null
      : (scenes[last + 1]?.replies[lang] ?? story.epilogue[lang]);
  if (/(讲|说|說|tell).*(故事|story)|textus.*story|story.*textus/i.test(input))
    return scenes[0].replies[lang];
  return scenes.find((scene) => scene.match.test(input))?.replies[lang] ?? null;
}

/** Everyday fallback replies use the same world, while addressing the
 * reader's immediate concern rather than starting the story again. */
export function everydayReply(language: string, line: string): string | null {
  if (language !== "zh" && language !== "zh-Hant" && language !== "en")
    return null;
  return (
    story.everyday.find((entry) => new RegExp(entry.pattern, "i").test(line))
      ?.replies[language] ?? null
  );
}
