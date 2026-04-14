import { describe, it, expect } from "vitest";

import { isBotMention, stripBotMention } from "./mention";

const BOT = "bot-123";

describe("isBotMention", () => {
  it("matches the standard mention form", () => {
    expect(isBotMention("<@bot-123> hi", BOT)).toBe(true);
  });

  it("matches the nickname mention form", () => {
    expect(isBotMention("<@!bot-123> hi", BOT)).toBe(true);
  });

  it("ignores mentions of other users", () => {
    expect(isBotMention("<@other> hi", BOT)).toBe(false);
    expect(isBotMention("<@!other> hi", BOT)).toBe(false);
  });

  it("ignores non-mentions", () => {
    expect(isBotMention("hello there", BOT)).toBe(false);
  });

  it("requires the mention at the start", () => {
    expect(isBotMention("oh <@bot-123> hi", BOT)).toBe(false);
  });
});

describe("stripBotMention", () => {
  it("strips the standard form", () => {
    expect(stripBotMention("<@bot-123> hello world", BOT)).toBe("hello world");
  });

  it("strips the nickname form", () => {
    expect(stripBotMention("<@!bot-123> hello world", BOT)).toBe("hello world");
  });

  it("trims whitespace after the mention", () => {
    expect(stripBotMention("<@bot-123>   hi   ", BOT)).toBe("hi");
  });

  it("returns the content unchanged when no mention present", () => {
    expect(stripBotMention("no mention", BOT)).toBe("no mention");
  });

  it("does not strip mid-message mentions", () => {
    expect(stripBotMention("hi <@bot-123>", BOT)).toBe("hi <@bot-123>");
  });
});
