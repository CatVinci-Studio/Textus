import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, openPhone, PHONE } from "./helpers";

// The tour's last AI lesson: the Settings › Textus AI provider controls,
// optional. The exercises before it stay on scripted replies.

/** Progress parked on the document-editing lesson, the one before. */
const AT_AGENT_EDIT = {
  "levis-tutorial-progress": JSON.stringify({
    active: true,
    stepId: "agentEdit",
    tabId: null,
  }),
};

async function skipToConnectAi(page: Page) {
  await page
    .locator(".tutorial-card")
    .getByRole("button", { name: "Skip this step" })
    .click();
  return page.getByRole("dialog", { name: "Connect your AI" });
}

test("the connect lesson can be skipped on to the ending", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: AT_AGENT_EDIT,
  });
  const lesson = await skipToConnectAi(page);
  await expect(lesson).toBeVisible();
  // The Settings controls, credentials open: sign in or paste a key.
  await expect(
    lesson.getByRole("button", { name: /^Provider: / }),
  ).toBeVisible();
  await expect(
    lesson.getByRole("button", { name: "Sign in with OpenAI" }),
  ).toBeVisible();
  await expect(lesson).toContainText("Settings › Textus AI");
  await expect(lesson.getByText("Connected.")).toHaveCount(0);

  await lesson.getByRole("button", { name: /Skip for now/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Tutorial finished" }),
  ).toBeVisible();

  // Back returns to it, and the ending's primary still finishes the tour.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(lesson).toBeVisible();
});

test("a connected provider shows Connected and Continue", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en", aiProvider: "anthropic" },
    storage: AT_AGENT_EDIT,
  });
  await mockInvoke(page, { claude_auth_status: { configured: true } });
  const lesson = await skipToConnectAi(page);
  await expect(lesson.getByText("Connected.", { exact: false })).toBeVisible();
  await expect(
    lesson.getByRole("button", { name: /Skip for now/ }),
  ).toHaveCount(0);
  await lesson.getByRole("button", { name: /Continue/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Tutorial finished" }),
  ).toBeVisible();
});

test("a key pasted into the lesson connects the provider", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en", aiProvider: "openai" },
    storage: AT_AGENT_EDIT,
  });
  const lesson = await skipToConnectAi(page);
  await lesson.getByRole("button", { name: "API Key" }).click();
  await lesson.getByPlaceholder("sk-…").fill("sk-test");
  // As the backend answers once the key is stored.
  await mockInvoke(page, {
    codex_auth_status: { configured: false },
    provider_api_key_status: true,
  });
  await lesson.getByRole("button", { name: "Save" }).click();
  await expect(lesson.getByText("Connected.", { exact: false })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use(PHONE);

  test("the connect lesson fits the screen and can be skipped", async ({
    page,
  }) => {
    await openPhone(page, { storage: AT_AGENT_EDIT });
    const lesson = await skipToConnectAi(page);
    await expect(lesson).toBeVisible();
    const box = (await lesson.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.viewport.width);
    await lesson.getByRole("button", { name: /Skip for now/ }).tap();
    await expect(
      page.getByRole("dialog", { name: "Tutorial finished" }),
    ).toBeVisible();
  });
});
