import { expect, test } from "bun:test";

import { isSingleEmoji, isVersionString, withEmojiPrefix } from "./hack-night.ts";

// These exact inputs failed in production on September 11. A displayed emoji
// may have multiple code points, and the dashboard already uses `v7.0`.
test("accepts the emoji and version from the failed hack night starts", () => {
  expect(isSingleEmoji("⚽️")).toBe(true);
  expect(isVersionString("v7.0")).toBe(true);
  expect(withEmojiPrefix("🌙hack-night", "⚽️")).toBe("⚽️hack-night");
});

test.each(["⚽", "🎉", "❤️", "☀", "☀️", "👍🏽", "👩‍💻", "🏳️‍🌈", "🇺🇸", "1️⃣"])(
  "accepts a single emoji: %s",
  (emoji) => {
    expect(isSingleEmoji(emoji)).toBe(true);
  },
);

test.each(["", "hello", "a️", "1", "🇺", "🎉🎉", "⚽️ hi", "⚽️ ", "<:ball:123>"])(
  "rejects a channel prefix that is not one Unicode emoji: %s",
  (value) => {
    expect(isSingleEmoji(value)).toBe(false);
  },
);

test.each(["⚽️", "👍🏽", "👩‍💻", "🏳️‍🌈", "🇺🇸", "1️⃣"])(
  "reset removes the whole %s prefix without leaving suffix code points",
  (emoji) => {
    const started = withEmojiPrefix("🌙hack-night", emoji);
    expect(withEmojiPrefix(started, "🌙")).toBe("🌙hack-night");
    expect(withEmojiPrefix(started, emoji)).toBe(started);
  },
);

test("renaming preserves channel text and only replaces its first emoji", () => {
  expect(withEmojiPrefix("hack-night", "⚽️")).toBe("⚽️hack-night");
  expect(withEmojiPrefix("⚽️hack-night🎉", "🌙")).toBe("🌙hack-night🎉");
  expect(withEmojiPrefix("1-hack-night", "🌙")).toBe("🌙1-hack-night");
});

test.each(["7.0", "v7.0", "7.0.1", "v7.0.1", "6.17"])(
  "accepts a dashboard version with or without a v prefix: %s",
  (version) => {
    expect(isVersionString(version)).toBe(true);
  },
);

test.each(["", "v", "7", "v7", "vv7.0", "v7.0-beta", "v7.0.1.2", "v7.0 ", "v7.0\n"])(
  "rejects a malformed dashboard version: %s",
  (version) => {
    expect(isVersionString(version)).toBe(false);
  },
);
