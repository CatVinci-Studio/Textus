import { SettingsGroup } from "./SettingsGroup";
import { SettingRow } from "../sections/controls";
import { runCommand } from "../../registry/commands";
import {
  pluginText,
  type PluginRecord,
} from "../../plugins/store/plugin-records";

/** A plugin's first steps (`contributes.walkthroughs`), each with the
 *  command that takes it, on its page while it runs: never a popup. */
export function PluginWalkthroughs({ record }: { record: PluginRecord }) {
  const manifest = record.manifest;
  if (!manifest) return null;
  const { walkthroughs, commands } = manifest.contributes;
  const text = (value: string) => pluginText(record, value);
  return walkthroughs.map((walkthrough, i) => (
    <SettingsGroup key={i} title={text(walkthrough.title)}>
      {walkthrough.steps.map((step, j) => (
        <SettingRow
          key={j}
          label={text(step.title)}
          hint={step.description ? text(step.description) : undefined}
        >
          {step.command && (
            <button
              type="button"
              className="tx-button text-button settings-inline-button"
              onClick={() => runCommand(step.command!)}
            >
              {text(
                commands.find((c) => c.command === step.command)?.title ??
                  step.command,
              )}
            </button>
          )}
        </SettingRow>
      ))}
    </SettingsGroup>
  ));
}
