import { expect, test } from "bun:test";

import { Result } from "./result/index.ts";
import { decodeDeliveryPayload, MAX_CONTENT_CHARS, MAX_SCHEDULE_CONTENT_CHARS } from "./wire.ts";

/**
 * `content` carries `max(9_000)` on the schema, but a refinement holds anything
 * that did not come from a schedule to 4_000. Nothing validates on the way *in* —
 * `enqueue` stringifies whatever it is handed — so an over-long fold is only
 * caught by `claim`, at which point the delivery is already on the queue and can
 * never be decoded off it.
 */
function deliveryOfLength(kind: "mention" | "scheduled", length: number): unknown {
  return {
    kind,
    dispatchId: crypto.randomUUID(),
    continuationKey: "99999999999999901",
    content: "x".repeat(length),
    messageId: "99999999999999900",
    principal: { userId: "99999999999999899", username: "p", nickname: "p", memberRoles: [] },
    channel: { id: "99999999999999901", name: "probe" },
    // A scheduled turn must carry both, and no other kind may.
    ...(kind === "scheduled"
      ? { scheduleId: crypto.randomUUID(), occurrenceId: "a".repeat(22) }
      : {}),
  };
}

test("a user message is capped well below the schema's own maximum", () => {
  expect(MAX_CONTENT_CHARS).toBeLessThan(MAX_SCHEDULE_CONTENT_CHARS);

  const atLimit = decodeDeliveryPayload(deliveryOfLength("mention", MAX_CONTENT_CHARS));
  expect(Result.isOk(atLimit)).toBe(true);

  // The window a fold sliced to the larger constant would land in: stored by
  // `enqueue` without complaint, then undecodable by `claim` forever.
  const overLimit = decodeDeliveryPayload(deliveryOfLength("mention", MAX_CONTENT_CHARS + 1));
  expect(Result.isError(overLimit)).toBe(true);
});

test("a scheduled prompt may use the larger limit", () => {
  const long = decodeDeliveryPayload(deliveryOfLength("scheduled", MAX_SCHEDULE_CONTENT_CHARS));
  expect(Result.isOk(long)).toBe(true);
});
