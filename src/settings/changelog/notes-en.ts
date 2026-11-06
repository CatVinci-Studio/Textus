import { withTranslations } from "./published";

export default withTranslations(
  import.meta.glob<string>("./notes/en/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);
