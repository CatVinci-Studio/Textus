/** The diary: a hidden mode in which a finished line is answered on the
 *  page in another hand, and the window becomes the book. Settings › About
 *  opens and closes it (five taps on the version), only once an AI
 *  provider is connected; nothing in the interface names it. */
export const isMagicDiary = (settings: { enableDiary: boolean }) =>
  settings.enableDiary;
