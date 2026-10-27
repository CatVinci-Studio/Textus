import { useState } from "react";
import { askAi } from "../../ai/chat/ask-ai";
import type { Strings } from "../../i18n/strings";
import { SettingRow, VERBATIM_INPUT } from "../sections/controls";
import { isImeKeydown } from "../../utils/ime";

/** Settings › Plugins › Make your own: what the user wants, in their words,
 *  handed to Textus AI's Create mode, which writes the plugin. */
export function DescribePlugin({
  t,
  onAsked,
}: {
  t: Strings;
  /** Settings closes, for the AI panel behind it. */
  onAsked: () => void;
}) {
  const [text, setText] = useState("");
  const make = () => {
    const wish = text.trim();
    if (!wish) return;
    onAsked();
    askAi(`${t.pluginsDescribeAsk}${wish}`, "create");
  };
  return (
    <SettingRow label={t.pluginsDescribeLabel}>
      <input
        className="settings-text-input plugin-describe-input"
        aria-label={t.pluginsDescribeLabel}
        placeholder={t.pluginsDescribePlaceholder}
        value={text}
        {...VERBATIM_INPUT}
        spellCheck
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !isImeKeydown(e)) make();
        }}
      />
      <button
        type="button"
        className="text-button settings-inline-button"
        disabled={!text.trim()}
        onClick={make}
      >
        {t.pluginsDescribeMake}
      </button>
    </SettingRow>
  );
}
