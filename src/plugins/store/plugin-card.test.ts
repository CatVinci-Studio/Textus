import { afterEach, expect, it } from "vitest";
import {
  LATER_LIMIT,
  answerPluginCard,
  cardKey,
  currentPluginCard,
  mutedCardCount,
  restoreCards,
  showPluginCard,
  type CardRequest,
} from "./plugin-card";

const offer: CardRequest = {
  plugin: "kanban",
  situation: { type: "offer", caller: { id: "importer", name: "Importer" } },
  installed: false,
};
const content: CardRequest = {
  plugin: "two-way-links",
  situation: { type: "content", kind: "wikilinks" },
  installed: false,
};
const open: CardRequest = {
  plugin: "pdf",
  situation: { type: "open", path: "/d/a.PDF" },
  installed: true,
};

afterEach(() => {
  while (currentPluginCard()) answerPluginCard("later");
  restoreCards();
});

it("keys a card by its situation", () => {
  expect(cardKey(offer)).toBe("offer:importer:kanban");
  expect(cardKey(content)).toBe("content:wikilinks");
  expect(cardKey(open)).toBe("open:.pdf");
});

it("shows one card at a time: an offer finds it taken, the others wait", async () => {
  const first = showPluginCard(content);
  expect(currentPluginCard()).toBe(content);
  expect(await showPluginCard(offer)).toBe("busy");
  expect(await showPluginCard(content)).toBe("busy");
  const second = showPluginCard(open);
  expect(currentPluginCard()).toBe(content);
  answerPluginCard("install");
  expect(await first).toBe("install");
  expect(currentPluginCard()).toBe(open);
  answerPluginCard("system");
  expect(await second).toBe("system");
  expect(currentPluginCard()).toBeNull();
});

it("asks again after Later, at most three times", async () => {
  for (let n = 0; n < LATER_LIMIT; n++) {
    const shown = showPluginCard(content);
    answerPluginCard("later");
    expect(await shown).toBe("later");
  }
  expect(await showPluginCard(content)).toBe("muted");
  expect(mutedCardCount()).toBe(1);
});

it("never asks again after ×, until restored", async () => {
  const shown = showPluginCard(offer);
  answerPluginCard("never");
  expect(await shown).toBe("never");
  expect(await showPluginCard(offer)).toBe("muted");
  // Another plugin's offer of it is another situation.
  const other = {
    ...offer,
    situation: { ...offer.situation, caller: { id: "x", name: "X" } },
  } as CardRequest;
  const again = showPluginCard(other);
  expect(currentPluginCard()).toBe(other);
  answerPluginCard("later");
  await again;
  restoreCards();
  expect(mutedCardCount()).toBe(0);
  const back = showPluginCard(offer);
  expect(currentPluginCard()).toBe(offer);
  answerPluginCard("later");
  await back;
});
