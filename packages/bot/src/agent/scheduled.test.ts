import { describe, expect, test } from "bun:test";

import { DiscordAPIError } from "@discordjs/rest";
import { DISCORD_IDS } from "@repo/shared/discord";
import { Transient } from "@repo/shared/errors";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import type { MessagePayload, ScheduledFirePayload } from "@repo/shared/wire";
import { RESTJSONErrorCodes } from "discord-api-types/v10";

import type { AgentRouter } from "./router.ts";
import {
  createScheduledFireHandler,
  isTransientDiscordFailure,
  scheduledFailureMessage,
  type ScheduledFireDeps,
} from "./scheduled.ts";

interface Receipt {
  readonly actionType: string;
  readonly channelId: string;
  readonly claimToken?: string;
  readonly ownerId: string;
  readonly scheduleId: string;
  readonly status: "accepted" | "forwarding";
}

function parseReceipt(raw: string): Receipt {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("actionType" in parsed) ||
    typeof parsed.actionType !== "string" ||
    !("channelId" in parsed) ||
    typeof parsed.channelId !== "string" ||
    !("ownerId" in parsed) ||
    typeof parsed.ownerId !== "string" ||
    !("scheduleId" in parsed) ||
    typeof parsed.scheduleId !== "string" ||
    !("status" in parsed) ||
    (parsed.status !== "accepted" && parsed.status !== "forwarding") ||
    ("claimToken" in parsed && typeof parsed.claimToken !== "string")
  ) {
    throw new Error("fake Redis received an invalid receipt");
  }
  const claimToken = "claimToken" in parsed ? parsed.claimToken : undefined;
  if (claimToken !== undefined && typeof claimToken !== "string") {
    throw new Error("fake Redis received an invalid claim token");
  }
  return {
    actionType: parsed.actionType,
    channelId: parsed.channelId,
    ownerId: parsed.ownerId,
    scheduleId: parsed.scheduleId,
    status: parsed.status,
    ...(claimToken === undefined ? {} : { claimToken }),
  };
}

class StrictReceiptRedis {
  readonly receipts = new Map<string, Receipt>();

  private claim(receiptKey: string, args: readonly unknown[]): number {
    const [scheduleId, ownerId, channelId, actionType, raw] = args;
    if (
      typeof scheduleId !== "string" ||
      typeof ownerId !== "string" ||
      typeof channelId !== "string" ||
      typeof actionType !== "string" ||
      typeof raw !== "string"
    ) {
      throw new Error("fake Redis received an invalid claim");
    }
    const current = this.receipts.get(receiptKey);
    if (current !== undefined) {
      const identityMatches =
        current.scheduleId === scheduleId &&
        current.ownerId === ownerId &&
        current.channelId === channelId &&
        current.actionType === actionType;
      if (!identityMatches) return -1;
      return current.status === "accepted" ? 2 : 0;
    }
    this.receipts.set(receiptKey, parseReceipt(raw));
    return 1;
  }

  private complete(receiptKey: string, args: readonly unknown[]): number {
    const [claimToken, raw] = args;
    const current = this.receipts.get(receiptKey);
    if (
      typeof claimToken !== "string" ||
      typeof raw !== "string" ||
      current?.status !== "forwarding" ||
      current.claimToken !== claimToken
    ) {
      return 0;
    }
    this.receipts.set(receiptKey, parseReceipt(raw));
    return 1;
  }

  private release(receiptKey: string, args: readonly unknown[]): number {
    const claimToken = args[0];
    const current = this.receipts.get(receiptKey);
    if (
      typeof claimToken !== "string" ||
      current?.status !== "forwarding" ||
      current.claimToken !== claimToken
    ) {
      return 0;
    }
    this.receipts.delete(receiptKey);
    return 1;
  }

  async eval(
    script: string,
    redisKeys: readonly string[],
    args: readonly unknown[],
  ): Promise<number> {
    const receiptKey = redisKeys[0];
    if (receiptKey === undefined) throw new Error("fake Redis expected one key");
    if (script.includes("ARGV[5]") && script.includes('"PX"')) {
      return this.claim(receiptKey, args);
    }
    if (script.includes('"EX"') && script.includes("claimToken")) {
      return this.complete(receiptKey, args);
    }
    if (script.includes('redis.call("DEL"')) return this.release(receiptKey, args);
    throw new Error("fake Redis received an unexpected script");
  }
}

interface FakeMessage {
  readonly edits: string[];
  readonly id: string;
  content: string;
  edit(content: string): Promise<FakeMessage>;
}

interface SendRecord {
  readonly allowedMentions: { readonly parse: readonly unknown[] };
  readonly content: string;
  readonly enforceNonce: boolean;
  readonly nonce: string;
}

function sendRecord(input: unknown): SendRecord {
  if (typeof input !== "object" || input === null) throw new Error("expected send options");
  const keys = Object.keys(input).sort();
  expect(keys).toEqual(["allowedMentions", "content", "enforceNonce", "nonce"]);
  if (
    !("content" in input) ||
    typeof input.content !== "string" ||
    !("nonce" in input) ||
    typeof input.nonce !== "string" ||
    !("enforceNonce" in input) ||
    typeof input.enforceNonce !== "boolean" ||
    !input.enforceNonce ||
    !("allowedMentions" in input) ||
    typeof input.allowedMentions !== "object" ||
    input.allowedMentions === null ||
    !("parse" in input.allowedMentions) ||
    !Array.isArray(input.allowedMentions.parse) ||
    input.allowedMentions.parse.length !== 0
  ) {
    throw new Error("unexpected Discord send options");
  }
  return {
    content: input.content,
    nonce: input.nonce,
    enforceNonce: input.enforceNonce,
    allowedMentions: { parse: input.allowedMentions.parse },
  };
}

function discordError(code: number, status: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: `Discord error ${code}` },
    code,
    status,
    "GET",
    "https://discord.test/member",
    { body: undefined, files: [] },
  );
}

const payload: ScheduledFirePayload = {
  scheduleId: "00000000-0000-4000-8000-000000000001",
  occurrenceId: "abcdefghijklmnopqrstuv",
  ownerId: "10000000000000000",
  channelId: "20000000000000000",
  description: "Morning task",
  actionType: "agent",
  prompt: "Do the thing",
  memberRoles: [DISCORD_IDS.roles.ORGANIZER],
  attemptNumber: 1,
  finalAttempt: false,
  scheduledFor: "2026-01-01T00:00:00.000Z",
};

interface HarnessOptions {
  readonly memberError?: unknown;
  readonly memberRoles?: readonly string[];
  readonly submitError?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const redis = new StrictReceiptRedis();
  const sends: SendRecord[] = [];
  const messages = new Map<string, FakeMessage>();
  const memberFetches: unknown[] = [];
  const channelFetches: unknown[] = [];
  const submissions: MessagePayload[] = [];
  let messageId = 40_000_000_000_000_000n;

  const destination = {
    id: payload.channelId,
    name: "scheduled-tasks",
    // oxlint-disable-next-line unicorn/no-null -- discord.js represents no parent as null
    parentId: null,
    isThread: () => false,
    isSendable: () => true,
    send: async (input: unknown) => {
      const sent = sendRecord(input);
      sends.push(sent);
      const existing = messages.get(sent.nonce);
      if (existing !== undefined) return existing;
      messageId += 1n;
      const message: FakeMessage = {
        id: messageId.toString(),
        content: sent.content,
        edits: [],
        async edit(content) {
          this.content = content;
          this.edits.push(content);
          return this;
        },
      };
      messages.set(sent.nonce, message);
      return message;
    },
  };

  const member = {
    id: payload.ownerId,
    user: { username: "owner" },
    displayName: "Owner",
    roles: { cache: new Map((options.memberRoles ?? []).map((role) => [role, true])) },
  };
  const guild = {
    members: {
      fetch: async (input: unknown) => {
        memberFetches.push(input);
        if (options.memberError !== undefined) throw options.memberError;
        return member;
      },
    },
    channels: {
      fetch: async (channelId: string, input: unknown) => {
        channelFetches.push({ channelId, input });
        if (channelId !== payload.channelId) throw new Error("unexpected destination");
        return destination;
      },
    },
  };
  const client = {
    guilds: { cache: new Map([["30000000000000000", guild]]) },
    isReady: () => true,
  };
  const agent = {
    submit: async (turn: MessagePayload) => {
      submissions.push(turn);
      return options.submitError
        ? Result.err(new Transient({ operation: "submit schedule", detail: "offline" }))
        : Result.ok(undefined);
    },
  };
  const handler = createScheduledFireHandler({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- intentionally minimal strict fake
    agent: agent as unknown as AgentRouter,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- intentionally minimal strict fake
    client: client as unknown as ScheduledFireDeps["client"],
    // oxlint-disable-next-line typescript/consistent-type-assertions -- intentionally minimal strict fake
    redis: redis as unknown as RedisClient,
    guildId: "30000000000000000",
  });

  return {
    channelFetches,
    handler,
    memberFetches,
    messages,
    redis,
    sends,
    submissions,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (cause) {
    return cause;
  }
  throw new Error("expected promise to reject");
}

describe("scheduled role refresh and fallbacks", () => {
  test("force-refreshes the member and current roles override the creation snapshot", async () => {
    const testHarness = harness({ memberRoles: [] });
    await testHarness.handler.submit(payload);
    expect(testHarness.memberFetches).toEqual([{ user: payload.ownerId, force: true }]);
    expect(testHarness.channelFetches).toEqual([
      { channelId: payload.channelId, input: { force: true } },
    ]);
    expect(testHarness.submissions[0]?.principal).toEqual({
      userId: payload.ownerId,
      username: "owner",
      nickname: "Owner",
      memberRoles: [],
    });

    // The accepted receipt is durable: a dispatcher retry does no Discord work.
    await testHarness.handler.submit(payload);
    expect(testHarness.memberFetches).toHaveLength(1);
    expect(testHarness.sends).toHaveLength(1);
  });

  test("a departed owner is downgraded to public with a visible warning", async () => {
    const testHarness = harness({
      memberError: discordError(RESTJSONErrorCodes.UnknownMember, 404),
    });
    await testHarness.handler.submit(payload);
    expect(testHarness.submissions[0]?.principal.memberRoles).toEqual([]);
    expect(testHarness.sends[0]?.content).toContain("no longer in the guild");
    expect(testHarness.sends[0]?.nonce).toBe(`w:${payload.occurrenceId}`);
  });

  test("an explicit transient Discord response may use the creation snapshot with warning", async () => {
    const testHarness = harness({ memberError: discordError(0, 503) });
    await testHarness.handler.submit(payload);
    expect(testHarness.submissions[0]?.principal.memberRoles).toEqual(payload.memberRoles);
    expect(testHarness.sends[0]?.content).toContain("creation-time role snapshot");
  });

  test("a recognized fetch transport outage may use the snapshot", async () => {
    const outage = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    });
    const testHarness = harness({ memberError: outage });
    await testHarness.handler.submit(payload);
    expect(testHarness.submissions[0]?.principal.memberRoles).toEqual(payload.memberRoles);
    expect(testHarness.sends[0]?.content).toContain("creation-time role snapshot");
  });

  test("the transport classifier is narrow and fail-closed", () => {
    expect(isTransientDiscordFailure(new DOMException("timed out", "TimeoutError"))).toBeTrue();
    expect(isTransientDiscordFailure(new DOMException("aborted", "AbortError"))).toBeTrue();
    expect(
      isTransientDiscordFailure(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
        }),
      ),
    ).toBeTrue();
    expect(isTransientDiscordFailure(new TypeError("bad response shape"))).toBeFalse();
    expect(
      isTransientDiscordFailure(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("programming"), { code: "ERR_ASSERTION" }),
        }),
      ),
    ).toBeFalse();
  });

  test("unknown errors fail closed instead of granting snapshot privileges", async () => {
    const testHarness = harness({ memberError: new TypeError("bad response shape") });
    expect(
      await rejectionOf(testHarness.handler.submit({ ...payload, finalAttempt: true })),
    ).toEqual(expect.objectContaining({ message: "bad response shape" }));
    expect(testHarness.submissions).toHaveLength(0);
    const notice = testHarness.messages.get(`f:${payload.occurrenceId}`);
    expect(notice?.content).toContain("final automatic attempt");
    expect(testHarness.redis.receipts).toHaveLength(0);
  });
});

describe("scheduled failure remediation", () => {
  test("turn submission failure replaces the placeholder with actionable terminal text", async () => {
    const testHarness = harness({ submitError: true });
    expect(
      await rejectionOf(testHarness.handler.submit({ ...payload, finalAttempt: true })),
    ).toEqual(expect.objectContaining({ message: expect.stringContaining("offline") }));
    const placeholder = testHarness.messages.get(`s:${payload.occurrenceId}`);
    expect(placeholder?.content).toContain("final automatic attempt");
    expect(placeholder?.content).toContain("list scheduled tasks");
    expect(placeholder?.content).toContain("cancel or replace");
    expect(testHarness.redis.receipts).toHaveLength(0);
  });

  test("nonterminal failures accurately promise an automatic retry", () => {
    expect(scheduledFailureMessage(payload)).toContain("retry automatically");
    expect(scheduledFailureMessage(payload)).not.toContain("final automatic attempt");
  });
});
