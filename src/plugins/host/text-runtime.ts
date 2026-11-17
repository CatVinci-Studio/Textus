import dates from "./runtime/text.js?raw";
import templater from "./runtime/text-templater.js?raw";

/** The text runtime both a plugin's host and its pages are given: dates,
 *  templates and Templater's tags, on `__textusText`. */
export const TEXT_RUNTIME = `${dates}\n${templater}`;
