import { expect, test, describe } from "bun:test";

import { SpamDetector, type MessageData } from "./anti-spam.ts";

// oxlint-disable oxclippy/too-many-lines, oxclippy/identity-op, oxclippy/similar-names

describe("spam detection logic", () => {
  // Helper to generate a generic message
  const makeMsg = (
    authorId: string,
    channelId: string,
    content: string,
    timeOffsetMs: number = 0,
    attachments: { size: number; contentType: string | null; name: string }[] = [],
  ): MessageData => ({
    authorId,
    channelId,
    content,
    createdAt: new Date(Date.now() + timeOffsetMs),
    url: `https://discord.com/${channelId}`,
    attachments,
  });

  test("basic spam detection", () => {
    const detector = new SpamDetector();

    let action = detector.processMessage(makeMsg("user1", "chan1", "spam"));
    expect(action).toMatchInlineSnapshot(`
      {
        "do": "nothing",
      }
    `);

    action = detector.processMessage(makeMsg("user1", "chan2", "spam"));
    expect(action).toMatchInlineSnapshot(`
      {
        "do": "nothing",
      }
    `);

    action = detector.processMessage(makeMsg("user1", "chan3", "spam"));
    expect(action).toMatchInlineSnapshot(`
      {
        "do": "nothing",
      }
    `);

    action = detector.processMessage(makeMsg("user1", "chan4", "spam"));
    expect(action).toMatchInlineSnapshot(`
      {
        "alertContent": 
      "# Likely spammer
      - https://discord.com/chan1
      - https://discord.com/chan2
      - https://discord.com/chan3
      - https://discord.com/chan4

      -# False alarm? Please ping Kian to let him know."
      ,
        "do": "alert",
        "signature": 13628138375735518580n,
      }
    `);
  });

  test("repeated message in one channel is not flagged", () => {
    const detector = new SpamDetector();
    for (let i = 0; i < 5; i++) {
      const action = detector.processMessage(makeMsg("user1", "same-chan", "spam"));
      expect(action).toMatchInlineSnapshot(`
        {
          "do": "nothing",
        }
      `);
    }
  });

  test("continued spam after the alerting updates the alert", () => {
    const detector = new SpamDetector();
    detector.processMessage(makeMsg("user1", "chan1", "spam"));
    detector.processMessage(makeMsg("user1", "chan2", "spam"));
    detector.processMessage(makeMsg("user1", "chan3", "spam"));

    // 4th message crosses threshold
    let action = detector.processMessage(makeMsg("user1", "chan4", "spam"));
    expect(action).toMatchInlineSnapshot(`
      {
        "alertContent": 
      "# Likely spammer
      - https://discord.com/chan1
      - https://discord.com/chan2
      - https://discord.com/chan3
      - https://discord.com/chan4

      -# False alarm? Please ping Kian to let him know."
      ,
        "do": "alert",
        "signature": 13628138375735518580n,
      }
    `);

    // 5th message appends to the alert
    action = detector.processMessage(makeMsg("user1", "chan5", "spam"));
    expect(action).toMatchInlineSnapshot(`
      {
        "alertContent": 
      "# Likely spammer
      - https://discord.com/chan1
      - https://discord.com/chan2
      - https://discord.com/chan3
      - https://discord.com/chan4
      - https://discord.com/chan5

      -# False alarm? Please ping Kian to let him know."
      ,
        "do": "alert",
        "signature": 13628138375735518580n,
      }
    `);
  });

  test("slow repeated messages are not flagged as spam", () => {
    const detector = new SpamDetector();

    // Send 3 messages, each 1 minute apart
    const minuteAgo = -60 * 1000;
    detector.processMessage(makeMsg("user1", "chan1", "spam", 3 * minuteAgo));
    detector.processMessage(makeMsg("user1", "chan2", "spam", 2 * minuteAgo));
    detector.processMessage(makeMsg("user1", "chan3", "spam", 1 * minuteAgo));

    // Send 4th message now
    const action = detector.processMessage(makeMsg("user1", "chan4", "spam", 0));

    // Because there was enough time between messages, they should not count as spam
    expect(action).toMatchInlineSnapshot(`
      {
        "do": "nothing",
      }
    `);
  });

  test("a non-spam message cancels spam flag", () => {
    const detector = new SpamDetector();
    detector.processMessage(makeMsg("user1", "chan1", "spam"));
    detector.processMessage(makeMsg("user1", "chan2", "spam"));
    detector.processMessage(makeMsg("user1", "chan3", "spam"));

    // Interrupt with normal message
    detector.processMessage(makeMsg("user1", "chan4", "hello guys"));

    // 4th spam message
    const action = detector.processMessage(makeMsg("user1", "chan5", "spam"));

    expect(action).toMatchInlineSnapshot(`
      {
        "do": "nothing",
      }
    `);
  });

  test("image signatures differentiate substantially different images", () => {
    const detector = new SpamDetector();
    const imgA = [{ size: 100, contentType: "image/png", name: "imgA.png" }];
    const imgB = [{ size: 999, contentType: "image/png", name: "imgB.png" }];

    detector.processMessage(makeMsg("user1", "chan1", "look", 0, imgA));
    detector.processMessage(makeMsg("user1", "chan2", "look", 0, imgA));
    detector.processMessage(makeMsg("user1", "chan3", "look", 0, imgA));

    // 4th message has different image
    const action = detector.processMessage(makeMsg("user1", "chan4", "look", 0, imgB));

    expect(action).toMatchInlineSnapshot(`
      {
        "do": "nothing",
      }
    `);
  });

  test("different users do not share spam alert state", () => {
    const detector = new SpamDetector();
    detector.processMessage(makeMsg("userA", "chan1", "spam"));
    detector.processMessage(makeMsg("userA", "chan2", "spam"));

    detector.processMessage(makeMsg("userB", "chan3", "spam"));
    const action = detector.processMessage(makeMsg("userB", "chan4", "spam"));

    expect(action).toMatchInlineSnapshot(`
      {
        "do": "nothing",
      }
    `);
  });
});
