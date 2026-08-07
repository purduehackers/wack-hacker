import { describe, expect, test } from "bun:test";

import { DISCORD_IDS } from "@repo/shared/discord";
import { Result } from "@repo/shared/result";
import type { ResetPayload } from "@repo/shared/wire";

import { resetConversationForPrincipal } from "./agent-chat.ts";

const continuationKey = "30000000000000000";
const requesterUserId = "10000000000000000";

function resetRecorder() {
  const resets: ResetPayload[] = [];
  return {
    agent: {
      reset: async (request: ResetPayload) => {
        resets.push(request);
        return Result.ok(undefined);
      },
    },
    resets,
  };
}

describe("agent conversation reset authorization", () => {
  test("rejects a reset from an unrelated public member", async () => {
    const recorder = resetRecorder();
    const result = await resetConversationForPrincipal(recorder.agent, {
      continuationKey,
      requesterUserId,
      principal: {
        userId: "10000000000000001",
        username: "other-member",
        nickname: "Other Member",
        memberRoles: [],
      },
    });

    expect(Result.isOk(result)).toBe(true);
    expect(recorder.resets).toEqual([]);
  });

  test("accepts a reset from the original requester", async () => {
    const recorder = resetRecorder();
    await resetConversationForPrincipal(recorder.agent, {
      continuationKey,
      requesterUserId,
      principal: {
        userId: requesterUserId,
        username: "requester",
        nickname: "Requester",
        memberRoles: [],
      },
    });

    expect(recorder.resets).toHaveLength(1);
    expect(recorder.resets[0]).toMatchObject({
      continuationKey,
      principal: { userId: requesterUserId },
    });
  });

  test("accepts a reset from a current organizer", async () => {
    const recorder = resetRecorder();
    await resetConversationForPrincipal(recorder.agent, {
      continuationKey,
      requesterUserId,
      principal: {
        userId: "10000000000000001",
        username: "organizer",
        nickname: "Organizer",
        memberRoles: [DISCORD_IDS.roles.ORGANIZER],
      },
    });

    expect(recorder.resets).toHaveLength(1);
    expect(recorder.resets[0]?.principal.userId).toBe("10000000000000001");
  });
});
