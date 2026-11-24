// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClosePrompt } from "./ClosePrompt";
import { SettingsProvider } from "../prefs/SettingsContext";
import { currentStrings } from "../i18n/current";
import type { useModalDialog } from "../engine/controls/useModalDialog";

describe("the close prompt", () => {
  afterEach(cleanup);

  function prompt() {
    const answers = { onSave: vi.fn(), onDiscard: vi.fn(), onCancel: vi.fn() };
    const t = currentStrings();
    render(
      <SettingsProvider>
        <ClosePrompt
          open
          phone
          dialogProps={{} as ReturnType<typeof useModalDialog>}
          t={t}
          {...answers}
        />
      </SettingsProvider>,
    );
    return { answers, t };
  }

  it("is not also Cancel once a choice is made", () => {
    const { answers, t } = prompt();
    fireEvent.click(screen.getByRole("button", { name: t.closePromptSave }));
    expect(answers.onSave).toHaveBeenCalledTimes(1);
    expect(answers.onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t.closePromptDiscard }));
    expect(answers.onDiscard).toHaveBeenCalledTimes(1);
    expect(answers.onCancel).not.toHaveBeenCalled();
  });

  it("is Cancel when Cancel is chosen", () => {
    const { answers, t } = prompt();
    fireEvent.click(screen.getByRole("button", { name: t.cancel }));
    expect(answers.onCancel).toHaveBeenCalledTimes(1);
    expect(answers.onSave).not.toHaveBeenCalled();
  });
});
