/** True in the browser build, where there is no Tauri and the platform
 *  modules use browser stand-ins. Set at build time. */
export const inBrowser = import.meta.env.TEXTUS_BROWSER === true;
