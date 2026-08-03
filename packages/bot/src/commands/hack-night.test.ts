import { expect, test } from "vitest";

import { isSingleEmoji, isVersionString, withEmojiPrefix } from "./hack-night.ts";

test("swapping the prefix leaves the rest of the channel name intact", () => {
  expect(withEmojiPrefix("🌙hack-night", "🎉")).toBe("🎉hack-night");
});

test("a name with no prefix simply gains one", () => {
  expect(withEmojiPrefix("hack-night", "🎉")).toBe("🎉hack-night");
});

test("repeated runs do not accumulate emoji", () => {
  // The reason only one leading pictographic character is stripped: running
  // start twice in an evening must not produce "🎉🎉🎉hack-night".
  const once = withEmojiPrefix("🌙hack-night", "🎉");
  const twice = withEmojiPrefix(once, "🚀");

  expect(twice).toBe("🚀hack-night");
});

test("emoji validation accepts a single emoji and nothing else", () => {
  expect(isSingleEmoji("🎉")).toBe(true);
  expect(isSingleEmoji("🌙")).toBe(true);

  // Discord accepts almost anything in a channel name, so an unchecked value
  // would let a typo rename the busiest channel in the server to arbitrary text.
  expect(isSingleEmoji("hack night")).toBe(false);
  expect(isSingleEmoji("")).toBe(false);
  expect(isSingleEmoji("🎉🎉")).toBe(false);
  expect(isSingleEmoji("🎉 ")).toBe(false);
  expect(isSingleEmoji("a")).toBe(false);
});

test("version validation matches the dashboard's own shape", () => {
  expect(isVersionString("6.17")).toBe(true);
  expect(isVersionString("6.17.1")).toBe(true);
  expect(isVersionString("6")).toBe(false);
  expect(isVersionString("v6.17")).toBe(false);
  expect(isVersionString("6.17-beta")).toBe(false);
  expect(isVersionString("")).toBe(false);
});
