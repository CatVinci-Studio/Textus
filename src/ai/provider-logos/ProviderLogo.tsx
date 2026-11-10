import "./provider-logo.css";

// Each provider's logo, by catalog id: inline, so the one-colour marks
// take the text colour and read on light and dark alike.
const LOGOS = import.meta.glob<string>("./*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

const svgFor = (id: string) => LOGOS[`./${id.replace(/-intl$/, "")}.svg`];

/** `id`'s logo; for one without (a custom endpoint) its initial. */
export function ProviderLogo({ id, label }: { id: string; label: string }) {
  const svg = svgFor(id);
  return svg ? (
    <span
      className="provider-logo"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  ) : (
    <span className="provider-logo provider-logo-letter" aria-hidden="true">
      {label.trim().charAt(0).toUpperCase()}
    </span>
  );
}
