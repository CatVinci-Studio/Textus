import {
  LOCAL_KEYS,
  readLocal,
  removeLocal,
  writeLocal,
} from "../../storage/local";

/** Web search starts as the composer's button was last left: on once
 *  pressed, across conversations and windows, until pressed again. */
export function webSearchOn(): boolean {
  return readLocal(LOCAL_KEYS.webSearch) === "1";
}

export function rememberWebSearch(on: boolean): void {
  if (on) writeLocal(LOCAL_KEYS.webSearch, "1");
  else removeLocal(LOCAL_KEYS.webSearch);
}
