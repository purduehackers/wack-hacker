import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { DiscordAPIError } from "@discordjs/rest";
import { DISCORD_GUILD_ID, DISCORD_IDS } from "@repo/shared/discord";
import { RESTJSONErrorCodes, Routes } from "discord-api-types/v10";

import { roleChanges, syncDiscordRoles, type RoleSyncDeps } from "./role-sync.ts";
import { decodeIdWebhook, verifySignature } from "./webhook.ts";

const { ADMIN, ORGANIZER, WACKY } = DISCORD_IDS.roles;
const DISCORD_ID = "123456789012345678";
const SECRET = `whsec_${Buffer.from("test-signing-key-bytes").toString("base64")}`;
const NOW = Date.parse("2026-10-13T18:00:00Z");

function signed(body: string, timestamp = Math.floor(NOW / 1_000)) {
  const id = "msg_test";
  const mac = createHmac("sha256", Buffer.from(SECRET.slice("whsec_".length), "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return { id, timestamp: String(timestamp), signature: `v1,${mac}`, body };
}

test("accepts a correctly signed request", () => {
  expect(verifySignature(SECRET, signed("{}"), NOW)).toBe(true);
});

test("accepts any matching signature in a rotation list", () => {
  const request = signed("{}");
  const rotated = {
    ...request,
    signature: `v1,${Buffer.alloc(32).toString("base64")} ${request.signature}`,
  };
  expect(verifySignature(SECRET, rotated, NOW)).toBe(true);
});

test("rejects a tampered body, a stale timestamp, and a missing header", () => {
  expect(verifySignature(SECRET, { ...signed("{}"), body: '{"x":1}' }, NOW)).toBe(false);
  expect(verifySignature(SECRET, signed("{}", Math.floor(NOW / 1_000) - 600), NOW)).toBe(false);
  expect(verifySignature(SECRET, { ...signed("{}"), signature: undefined }, NOW)).toBe(false);
  expect(verifySignature("", signed("{}"), NOW)).toBe(false);
});

test("decodes a role change and ignores events it does not handle", () => {
  const roles = decodeIdWebhook(
    JSON.stringify({
      type: "user.roles.changed",
      timestamp: "2026-10-13T18:00:00.000Z",
      data: {
        user: { sub: "u1", preferred_username: "x", discord_id: DISCORD_ID },
        previous_roles: ["organizer"],
        roles: [],
      },
    }),
  );
  expect(roles.kind).toBe("event");
  expect(decodeIdWebhook(JSON.stringify({ type: "webhook.test", data: {} }))).toEqual({
    kind: "ignored",
    type: "webhook.test",
  });
  expect(decodeIdWebhook("not json").kind).toBe("invalid");
});

test("an ID admin holds both managed roles; unmanaged roles are left alone", () => {
  expect(roleChanges([WACKY], ["organizer", "admin"])).toEqual({
    add: [ORGANIZER, ADMIN],
    remove: [],
  });
  expect(roleChanges([WACKY, ORGANIZER, ADMIN], ["organizer"])).toEqual({
    add: [],
    remove: [ADMIN],
  });
  expect(roleChanges([WACKY, ORGANIZER], [])).toEqual({ add: [], remove: [ORGANIZER] });
  expect(roleChanges([ORGANIZER], ["alumni"])).toEqual({ add: [], remove: [ORGANIZER] });
});

function harness(memberRoles: string[] | RESTJSONErrorCodes) {
  let mark = 0;
  const calls: string[] = [];
  const deps: RoleSyncDeps = {
    redis: {
      // Mirrors the ADVANCE script: reject anything older than the mark.
      eval: async (_script, _keys, args) => {
        const incoming = Number(args[0]);
        if (incoming < mark) return 0;
        mark = incoming;
        return 1;
      },
    },
    rest: {
      get: async () => {
        if (!Array.isArray(memberRoles)) {
          throw new DiscordAPIError(
            { code: memberRoles, message: "Unknown" },
            memberRoles,
            404,
            "GET",
            "",
            {},
          );
        }
        return { roles: memberRoles };
      },
      put: async (route) => {
        calls.push(`PUT ${route}`);
        return undefined;
      },
      delete: async (route) => {
        calls.push(`DELETE ${route}`);
        return undefined;
      },
    },
  };
  return { deps, calls };
}

test("removes the organizer role when ID demotes the user", async () => {
  const { deps, calls } = harness([ORGANIZER, WACKY]);
  const outcome = await syncDiscordRoles(deps, {
    discordId: DISCORD_ID,
    idRoles: [],
    occurredAt: new Date(NOW),
  });
  expect(outcome.status).toBe("applied");
  expect(calls).toEqual([
    `DELETE ${Routes.guildMemberRole(DISCORD_GUILD_ID, DISCORD_ID, ORGANIZER)}`,
  ]);
});

test("drops an event older than the last one applied", async () => {
  const { deps, calls } = harness([]);
  await syncDiscordRoles(deps, {
    discordId: DISCORD_ID,
    idRoles: ["organizer"],
    occurredAt: new Date(NOW),
  });
  const late = await syncDiscordRoles(deps, {
    discordId: DISCORD_ID,
    idRoles: [],
    occurredAt: new Date(NOW - 60_000),
  });
  expect(late.status).toBe("stale");
  expect(calls).toHaveLength(1);
});

test("a user who left the server or deleted their account is skipped, not retried", async () => {
  for (const code of [RESTJSONErrorCodes.UnknownMember, RESTJSONErrorCodes.UnknownUser]) {
    const { deps } = harness(code);
    const outcome = await syncDiscordRoles(deps, {
      discordId: DISCORD_ID,
      idRoles: ["organizer"],
      occurredAt: new Date(NOW),
    });
    expect(outcome.status).toBe("not-in-guild");
  }
});
