import { expect, test } from "bun:test";

import { createSpamDetector, type SpamMessage } from "./anti-spam.ts";

function post(
  authorId: string,
  channelId: string,
  content: string,
  overrides: Partial<SpamMessage> = {},
): SpamMessage {
  return {
    authorId,
    channelId,
    content,
    createdAt: new Date(),
    url: `https://discord.com/${channelId}`,
    attachments: [],
    ...overrides,
  };
}

const MINUTE_MS = 60_000;

/**
 * Four channels, not three: the threshold counts channels the run has *passed*,
 * so the message that crosses it is the fourth. The alert lists every copy,
 * including the one that triggered it, because a moderator acting on it needs
 * to reach all of them.
 */
test("the same content in four channels is a spree", () => {
  const detector = createSpamDetector();

  expect(detector.observe(post("user1", "chan1", "spam"))).toBeUndefined();
  expect(detector.observe(post("user1", "chan2", "spam"))).toBeUndefined();
  expect(detector.observe(post("user1", "chan3", "spam"))).toBeUndefined();

  expect(detector.observe(post("user1", "chan4", "spam"))).toBe(
    [
      "# Likely spammer",
      "- https://discord.com/chan1",
      "- https://discord.com/chan2",
      "- https://discord.com/chan3",
      "- https://discord.com/chan4",
      "",
      "-# False alarm? Please ping Kian to let him know.",
    ].join("\n"),
  );
});

/** Repeating yourself in one place is rude, not an attack. */
test("repetition inside a single channel is never a spree", () => {
  const detector = createSpamDetector();
  for (let attempt = 0; attempt < 5; attempt++) {
    expect(detector.observe(post("user1", "same-chan", "spam"))).toBeUndefined();
  }
});

/** Each further copy re-reports the whole run, so the handler edits one alert. */
test("a copy after the threshold reports the run again, grown by one", () => {
  const detector = createSpamDetector();
  for (const channelId of ["chan1", "chan2", "chan3", "chan4"]) {
    detector.observe(post("user1", channelId, "spam"));
  }

  const body = detector.observe(post("user1", "chan5", "spam"));
  expect(body).toContain("- https://discord.com/chan1");
  expect(body).toContain("- https://discord.com/chan5");
});

/** The window is what separates a spree from someone posting the same link all day. */
test("copies spread beyond the window do not accumulate", () => {
  const detector = createSpamDetector();
  detector.observe(
    post("user1", "chan1", "spam", { createdAt: new Date(Date.now() - 3 * MINUTE_MS) }),
  );
  detector.observe(
    post("user1", "chan2", "spam", { createdAt: new Date(Date.now() - 2 * MINUTE_MS) }),
  );
  detector.observe(post("user1", "chan3", "spam", { createdAt: new Date(Date.now() - MINUTE_MS) }));

  expect(detector.observe(post("user1", "chan4", "spam"))).toBeUndefined();
});

/**
 * The deliberate bias towards missing a spree: one ordinary message in the
 * window ends the run, so a member cross-posting while talking is never named.
 */
test("anything else the author says ends the run", () => {
  const detector = createSpamDetector();
  detector.observe(post("user1", "chan1", "spam"));
  detector.observe(post("user1", "chan2", "spam"));
  detector.observe(post("user1", "chan3", "spam"));
  detector.observe(post("user1", "chan4", "hello guys"));

  expect(detector.observe(post("user1", "chan5", "spam"))).toBeUndefined();
});

/** Identical captions are not enough; the attachment is part of what was posted. */
test("a different attachment breaks the signature", () => {
  const detector = createSpamDetector();
  const first = [{ name: "first.png", size: 100, contentType: "image/png" }];
  const second = [{ name: "second.png", size: 999, contentType: "image/png" }];

  for (const channelId of ["chan1", "chan2", "chan3"]) {
    detector.observe(post("user1", channelId, "look", { attachments: first }));
  }

  expect(detector.observe(post("user1", "chan4", "look", { attachments: second }))).toBeUndefined();
});

/** Two members posting the same popular link must not add up to one spree. */
test("runs are tracked per author", () => {
  const detector = createSpamDetector();
  detector.observe(post("userA", "chan1", "spam"));
  detector.observe(post("userA", "chan2", "spam"));
  detector.observe(post("userB", "chan3", "spam"));

  expect(detector.observe(post("userB", "chan4", "spam"))).toBeUndefined();
});
