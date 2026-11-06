import { withTranslations } from "./published";

export default withTranslations(
  import.meta.glob<string>("./notes/zh-Hant/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);
