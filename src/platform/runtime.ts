/** True in the browser build (the playground, later the web app), where
 *  there is no Tauri and the platform modules use their browser stand-ins.
 *  Set at build time by vite.playground.config.ts. */
export const inBrowser = import.meta.env.TEXTUS_BROWSER === true;
