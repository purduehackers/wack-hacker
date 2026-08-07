/// <reference types="bun" />

import { beforeEach, expect, spyOn, test } from "bun:test";

import { createRenderPublisher } from "../../packages/agents/agent/lib/discord/render-intent.ts";
import type { AgentClient } from "../../packages/bot/src/agent/client.ts";
import type { DiscordRest } from "../../packages/bot/src/agent/render/discord-rest.ts";
import { createTurnMessageStore } from "../../packages/bot/src/agent/turn-messages.ts";
import { createConversationFlow } from "../../packages/bot/src/conversations/flow.ts";
import {
  createConversationStore,
  DELIVERY_LEASE_MS,
  type ConversationStore,
  type ConversationStoreDeps,
  type HitlClaimInput,
} from "../../packages/shared/src/conversations/index.ts";
import { getRedis, type RedisClient } from "../../packages/shared/src/redis/client.ts";
import { Result } from "../../packages/shared/src/result/index.ts";
import { silentReporter } from "../../packages/shared/src/result/observe.ts";
import type {
  DeliveryPayload,
  InteractionPayload,
  MessagePayload,
  ParkedPayload,
  RenderIntent,
} from "../../packages/shared/src/wire.ts";

const contractUrl = process.env["CONTRACT_REDIS_URL"];
const contractToken = process.env["CONTRACT_REDIS_TOKEN"];

function contractRedis(): RedisClient {
  if (contractUrl === undefined || contractToken === undefined) {
    throw new Error("run contract tests through `bun run test:contracts:docker`");
  }
  const url = new URL(contractUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("contract Redis must be an isolated loopback HTTP endpoint");
  }
  return getRedis({ url: url.href, token: contractToken });
}

function conversations(
  redis: RedisClient,
  overrides: Omit<ConversationStoreDeps, "redis"> = {},
): ConversationStore {
  return createConversationStore({ redis, ...overrides });
}

const redisAvailable = contractUrl !== undefined && contractToken !== undefined;
const contractTest = redisAvailable ? test : test.skip;

beforeEach(async () => {
  if (!redisAvailable) return;
  await contractRedis().eval('return redis.call("FLUSHDB")', [], []);
});

function message(
  messageId: string,
  content: string,
  continuationKey = "30000000000000000",
): MessagePayload {
  return {
    kind: "followup",
    continuationKey,
    content,
    messageId,
    principal: {
      userId: "10000000000000000",
      username: "requester",
      nickname: "Requester",
      memberRoles: [],
    },
    channel: { id: "20000000000000000", name: "agent" },
  };
}

async function waitUntil(check: () => Promise<boolean>, detail: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for ${detail}`);
}

const successfulCallbackFetch: typeof globalThis.fetch = Object.assign(
  async () => new Response(undefined, { status: 204 }),
  { preconnect: globalThis.fetch.preconnect },
);

async function startStreamingTurn(
  redis: RedisClient,
  queue: ConversationStore["queue"],
  source: MessagePayload,
  inputRequests: NonNullable<RenderIntent["inputRequests"]>,
): Promise<DeliveryPayload> {
  await queue.enqueue(source);
  const claimed = await queue.claim(source.continuationKey);
  if (Result.isError(claimed)) throw claimed.error;
  const delivery = claimed.value?.payload;
  if (delivery === undefined) throw new Error("streaming delivery was not claimed");

  const attemptId = crypto.randomUUID();
  if ((await conversations(redis).admission.start(delivery, attemptId)).status !== "start") {
    throw new Error("streaming delivery was not admitted");
  }
  const publisher = createRenderPublisher({
    store: conversations(redis).renderPublication,
    botUrl: "http://bot.invalid",
    botSecret: "contract-secret",
    fetch: successfulCallbackFetch,
  });
  if (
    !(await publisher.publish({
      dispatchId: delivery.dispatchId,
      continuationKey: delivery.continuationKey,
      messageId: delivery.messageId,
      sessionId: "session-input",
      eveTurnId: "turn-input",
      revision: 1,
      phase: "streaming",
      text: "Choose",
      activity: "Waiting",
      inputRequests,
    }))
  ) {
    throw new Error("streaming input request was not published");
  }
  if (!(await conversations(redis).admission.finish(delivery.continuationKey, attemptId))) {
    throw new Error("streaming admission was not released");
  }
  return delivery;
}

class MemoryDiscord {
  readonly messages = new Map<string, string>();
  readonly nonces = new Map<string, string>();
  #nextId = 90_000_000_000_000_000n;

  #create(content: string, nonce?: string): { id: string; content: string } {
    if (nonce !== undefined) {
      const existing = this.nonces.get(nonce);
      if (existing !== undefined)
        return { id: existing, content: this.messages.get(existing) ?? "" };
    }
    const id = String(this.#nextId++);
    this.messages.set(id, content);
    if (nonce !== undefined) this.nonces.set(nonce, id);
    return { id, content };
  }

  readonly rest: DiscordRest = {
    postMessage: async (_channelId, body) =>
      Result.ok(
        this.#create(body.content ?? "", body.nonce === undefined ? undefined : String(body.nonce)),
      ),
    reply: async (_channelId, _messageId, content, nonce) =>
      Result.ok(this.#create(content, nonce)),
    editMessage: async (_channelId, messageId, content) => {
      this.messages.set(messageId, content);
      return Result.ok(undefined);
    },
    deleteMessage: async (_channelId, messageId) => {
      this.messages.delete(messageId);
      return Result.ok(undefined);
    },
  };
}

contractTest(
  "queue Lua preserves dedupe, FIFO, leases, independent keys, and reset cutover",
  async () => {
    const redis = contractRedis();
    const now = 1_000;
    const queue = conversations(redis, { now: () => now }).queue;
    const first = message("40000000000000000", "first");
    const second = message("40000000000000001", "second");
    const independent = message("40000000000000002", "independent", "30000000000000001");

    await queue.enqueue(first);
    await queue.enqueue(first);
    await queue.enqueue(second);
    await queue.enqueue(independent);

    expect(await queue.depth(first.continuationKey)).toBe(2);
    expect(await queue.depth(independent.continuationKey)).toBe(1);

    const claimedFirst = await queue.claim(first.continuationKey);
    expect(Result.isOk(claimedFirst) && claimedFirst.value?.payload.messageId).toBe(
      first.messageId,
    );
    const blocked = await queue.claim(first.continuationKey);
    expect(Result.isOk(blocked) && blocked.value).toBeUndefined();

    const claimedIndependent = await queue.claim(independent.continuationKey);
    expect(Result.isOk(claimedIndependent) && claimedIndependent.value?.payload.messageId).toBe(
      independent.messageId,
    );

    const restarted = conversations(redis, {
      now: () => now + DELIVERY_LEASE_MS + 1,
      newToken: () => "restarted-owner",
    }).queue;
    const reclaimed = await restarted.claim(first.continuationKey);
    expect(Result.isOk(reclaimed) && reclaimed.value?.payload.messageId).toBe(first.messageId);
    expect(Result.isOk(reclaimed) && reclaimed.value?.claimToken).toBe("restarted-owner");

    await queue.purge(first.continuationKey);
    await queue.purge(independent.continuationKey);

    const beforeReset = message("40000000000000003", "before reset");
    const afterReset = message("40000000000000004", "after reset");
    await queue.enqueue(beforeReset);
    const resetId = await queue.beginReset(beforeReset.continuationKey);
    await queue.enqueue(afterReset);
    expect(await queue.claim(beforeReset.continuationKey)).toEqual(Result.ok(undefined));
    expect(await queue.commitReset(beforeReset.continuationKey, resetId)).toBe(true);

    const postReset = await queue.claim(beforeReset.continuationKey);
    expect(Result.isOk(postReset) && postReset.value?.payload.messageId).toBe(afterReset.messageId);
    await queue.purge(beforeReset.continuationKey);
  },
);

contractTest("delivery admission recovers lost responses and fences ambiguous work", async () => {
  const redis = contractRedis();
  const queue = conversations(redis).queue;
  const continuationKey = "30000000000000010";

  const acceptedMessage = message("40000000000000020", "accepted", continuationKey);
  await queue.enqueue(acceptedMessage);
  const acceptedClaim = await queue.claim(continuationKey);
  if (Result.isError(acceptedClaim)) throw acceptedClaim.error;
  const acceptedDelivery = acceptedClaim.value?.payload;
  if (acceptedDelivery === undefined) throw new Error("accepted delivery was not claimed");

  const acceptedAttempt = crypto.randomUUID();
  expect(await conversations(redis).admission.start(acceptedDelivery, acceptedAttempt)).toEqual({
    status: "start",
    admissionAttemptId: acceptedAttempt,
  });
  expect(
    await conversations(redis).admission.confirm(acceptedDelivery, "session-lost-response"),
  ).toBe(true);
  expect(await conversations(redis).admission.finish(continuationKey, acceptedAttempt)).toBe(true);
  expect(await conversations(redis).admission.start(acceptedDelivery, crypto.randomUUID())).toEqual(
    {
      status: "accepted",
      sessionId: "session-lost-response",
    },
  );
  await queue.purge(continuationKey);

  const ambiguousMessage = message("40000000000000021", "ambiguous", continuationKey);
  await queue.enqueue(ambiguousMessage);
  const ambiguousClaim = await queue.claim(continuationKey);
  if (Result.isError(ambiguousClaim)) throw ambiguousClaim.error;
  const ambiguousDelivery = ambiguousClaim.value?.payload;
  if (ambiguousDelivery === undefined) throw new Error("ambiguous delivery was not claimed");

  const ambiguousAttempt = crypto.randomUUID();
  expect(await conversations(redis).admission.start(ambiguousDelivery, ambiguousAttempt)).toEqual({
    status: "start",
    admissionAttemptId: ambiguousAttempt,
  });
  expect(await conversations(redis).admission.finish(continuationKey, ambiguousAttempt)).toBe(true);
  const recoveryLog = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(
      await conversations(redis).admission.start(ambiguousDelivery, crypto.randomUUID()),
    ).toEqual({
      status: "recovery-required",
    });
    expect(recoveryLog).toHaveBeenCalledTimes(1);
  } finally {
    recoveryLog.mockRestore();
  }
  await queue.purge(continuationKey);
});

contractTest(
  "queue recovery publishes one durable failed intent for an ambiguous admission",
  async () => {
    const redis = contractRedis();
    const queue = conversations(redis).queue;
    const continuationKey = "30000000000000011";
    const source = message("40000000000000022", "ambiguous recovery", continuationKey);
    await queue.enqueue(source);
    const claimed = await queue.claim(continuationKey);
    if (Result.isError(claimed)) throw claimed.error;
    const delivery = claimed.value?.payload;
    if (delivery === undefined) throw new Error("ambiguous delivery was not claimed");

    const attemptId = crypto.randomUUID();
    expect(await conversations(redis).admission.start(delivery, attemptId)).toEqual({
      status: "start",
      admissionAttemptId: attemptId,
    });
    expect(await conversations(redis).admission.finish(continuationKey, attemptId)).toBe(true);

    expect(await queue.recoverAdmission(continuationKey)).toEqual(Result.ok(delivery));
    const recovered = await conversations(redis).render.intent(delivery.dispatchId);
    expect(Result.isOk(recovered) && recovered.value).toMatchObject({
      dispatchId: delivery.dispatchId,
      continuationKey,
      messageId: source.messageId,
      sessionId: "recovery-required",
      eveTurnId: "delivery-admission-recovery",
      revision: 1,
      phase: "failed",
    });
    expect(await queue.recoverAdmission(continuationKey)).toEqual(Result.ok(undefined));
    await queue.purge(continuationKey);
  },
);

contractTest("HITL Lua admits one answer and reset makes the control stale", async () => {
  const redis = contractRedis();
  const queue = conversations(redis).queue;
  const continuationKey = "30000000000000020";
  const source = message("40000000000000030", "approval", continuationKey);
  const delivery = await startStreamingTurn(redis, queue, source, [
    {
      requestId: "approval-1",
      recipientUserId: "10000000000000000",
      prompt: "Continue?",
      kind: "question",
      display: "confirmation",
    },
  ]);

  const hitl = conversations(redis).hitl;
  const approval: HitlClaimInput = {
    dispatchId: delivery.dispatchId,
    continuationKey,
    revision: 1,
    requestIndex: 0,
    requestId: "approval-1",
    recipientUserId: "10000000000000000",
    interactionId: "40000000000000031",
  };
  const contender = { ...approval, interactionId: "40000000000000032" };
  const outcomes = await Promise.all([hitl.claim(approval), hitl.claim(contender)]);
  expect([...outcomes].sort()).toEqual(["acquired", "claimed"]);

  const winner = outcomes[0] === "acquired" ? approval : contender;
  const loser = winner === approval ? contender : approval;
  expect(await hitl.complete(winner.dispatchId, winner.revision, winner.interactionId)).toBe(true);
  expect(await hitl.complete(loser.dispatchId, loser.revision, loser.interactionId)).toBe(false);

  await queue.beginReset(continuationKey);
  expect(await hitl.claim(approval)).toBe("stale");
  await queue.purge(continuationKey);
});

contractTest(
  "interaction admission Lua fences duplicate, conflicting, and reset controls",
  async () => {
    const redis = contractRedis();
    const queue = conversations(redis).queue;
    const continuationKey = "30000000000000021";
    const source = message("40000000000000040", "interaction", continuationKey);
    const delivery = await startStreamingTurn(redis, queue, source, [
      {
        requestId: "approval-2",
        recipientUserId: "10000000000000000",
        prompt: "Continue?",
        kind: "question",
        display: "confirmation",
        options: [
          { id: "approve", label: "Approve" },
          { id: "deny", label: "Deny" },
        ],
      },
    ]);
    const interaction: InteractionPayload = {
      continuationKey,
      interactionId: "40000000000000041",
      dispatchId: delivery.dispatchId,
      renderRevision: 1,
      requestId: "approval-2",
      authChannelId: source.channel.id,
      optionId: "approve",
      principal: source.principal,
    };

    const claims = await Promise.all([
      conversations(redis).interactions.claim(interaction),
      conversations(redis).interactions.claim(interaction),
    ]);
    expect(claims.map(({ claim }) => claim).sort((left, right) => left - right)).toEqual([0, 1]);
    expect(
      (
        await conversations(redis).interactions.claim({
          ...interaction,
          optionId: "deny",
        })
      ).claim,
    ).toBe(-1);

    expect(
      await conversations(redis).admission.finish(continuationKey, interaction.interactionId),
    ).toBe(true);
    await queue.beginReset(continuationKey);
    expect(
      (
        await conversations(redis).interactions.claim({
          ...interaction,
          interactionId: "40000000000000042",
        })
      ).claim,
    ).toBe(-1);
    await queue.purge(continuationKey);
  },
);

contractTest("render leases survive renewal through the Upstash-compatible transport", async () => {
  const redis = contractRedis();
  const store = conversations(redis).render;
  const dispatchId = crypto.randomUUID();
  const token = await store.claim(dispatchId);
  expect(token).toBeDefined();
  const before = await redis.eval(
    'return {redis.call("GET", KEYS[1]), redis.call("PTTL", KEYS[1])}',
    [`agent:render-claim:${dispatchId}`],
    [],
  );
  expect(Array.isArray(before) && before[0]).toBe(token);
  expect(Array.isArray(before) && Number(before[1])).toBeGreaterThan(44_000);
  if (token === undefined) return;
  expect(await store.renew(dispatchId, token)).toBe(true);
  const after = await redis.eval(
    'return {redis.call("GET", KEYS[1]), redis.call("PTTL", KEYS[1])}',
    [`agent:render-claim:${dispatchId}`],
    [],
  );
  expect(Array.isArray(after) && after[0]).toBe(token);
  expect(Array.isArray(after) && Number(after[1])).toBeGreaterThan(44_000);
});

contractTest(
  "render release and discard preserve claim ownership and terminal outcome",
  async () => {
    const redis = contractRedis();
    const store = conversations(redis).render;
    const unownedDispatchId = crypto.randomUUID();
    const firstToken = await store.claim(unownedDispatchId);
    if (firstToken === undefined) throw new Error("render lease was not claimed");
    await store.release(unownedDispatchId, `${firstToken}-stale`);
    expect(await store.claim(unownedDispatchId)).toBeUndefined();
    await store.release(unownedDispatchId, firstToken);
    expect(await store.claim(unownedDispatchId)).toBeDefined();

    const queue = conversations(redis).queue;
    const source = message("40000000000000050", "discard this render", "30000000000000030");
    const delivery = await startStreamingTurn(redis, queue, source, []);
    expect((await store.ready()).includes(delivery.dispatchId)).toBe(true);
    await store.discard(delivery.dispatchId);
    expect(await store.outcome(delivery.dispatchId)).toBe("discarded");
    expect((await store.ready()).includes(delivery.dispatchId)).toBe(false);
    expect(Result.isOk(await store.intent(delivery.dispatchId))).toBe(true);
    expect(Result.isOk(await store.target(delivery.dispatchId))).toBe(true);
    await queue.purge(source.continuationKey);
  },
);

contractTest(
  "authorization challenge Lua maintains the reset-cleanable dispatch index",
  async () => {
    const store = conversations(contractRedis());
    const dispatchId = crypto.randomUUID();
    const authorizationId = "authorization-1";
    const challenge = {
      description: "Connect the provider",
      url: "https://example.com/authorize",
      userCode: "ABCD-EFGH",
    };

    await store.authorizations.store(dispatchId, authorizationId, challenge, 600, 3_600);
    expect(await store.render.authorization(dispatchId, authorizationId)).toEqual(
      Result.ok(challenge),
    );
    await store.authorizations.delete(dispatchId, authorizationId);
    expect(await store.render.authorization(dispatchId, authorizationId)).toEqual(
      Result.ok(undefined),
    );
  },
);

contractTest(
  "scheduled-fire Lua claims, releases, and durably accepts one occurrence",
  async () => {
    const store = conversations(contractRedis()).scheduledFires;
    const payload = {
      scheduleId: crypto.randomUUID(),
      occurrenceId: "abcdefghijklmnopqrstuv",
      ownerId: "10000000000000000",
      channelId: "20000000000000000",
      description: "post an update",
      actionType: "message" as const,
      prompt: "The update",
      attemptNumber: 1,
      finalAttempt: false,
      scheduledFor: "2026-01-01T00:00:00.000Z",
    };

    expect(await store.claim(payload, "claim-1")).toBe("acquired");
    expect(await store.claim(payload, "claim-2")).toBe("busy");
    await store.release(payload.occurrenceId, "claim-2");
    expect(await store.claim(payload, "claim-2")).toBe("busy");
    await store.release(payload.occurrenceId, "claim-1");
    expect(await store.claim(payload, "claim-3")).toBe("acquired");
    expect(await store.complete(payload, "claim-3")).toBe(true);
    expect(await store.claim(payload, "claim-4")).toBe("accepted");
  },
);

const callbackFetch: typeof globalThis.fetch = Object.assign(
  async () => {
    throw new Error("simulated lost render callback");
  },
  { preconnect: globalThis.fetch.preconnect },
);

function createAdmissionClient(redis: RedisClient, sent: DeliveryPayload[]): AgentClient {
  return {
    sendMessage: async (delivery) => {
      sent.push(delivery);
      const attemptId = crypto.randomUUID();
      const admission = await conversations(redis).admission.start(delivery, attemptId);
      if (admission.status !== "start") {
        throw new Error(`unexpected admission status ${admission.status}`);
      }
      const sessionId = `session-${sent.length}`;
      if (!(await conversations(redis).admission.confirm(delivery, sessionId))) {
        throw new Error("agent delivery confirmation failed");
      }
      if (!(await conversations(redis).admission.finish(delivery.continuationKey, attemptId))) {
        throw new Error("agent admission release failed");
      }
      return Result.ok({ sessionId, continuationToken: delivery.continuationKey });
    },
    sendInteraction: async () => {
      throw new Error("unexpected interaction delivery");
    },
    sendReset: async () => {
      throw new Error("unexpected reset delivery");
    },
  };
}

async function startBotRuntime(
  redis: RedisClient,
  store: ConversationStore,
  discord: MemoryDiscord,
  client: AgentClient,
) {
  const flow = createConversationFlow({
    eve: client,
    store,
    rest: discord.rest,
    turnMessages: createTurnMessageStore(redis),
    schedules: { admit: async () => {} },
    reporter: silentReporter,
    recoveryIntervalMs: 0,
  });
  await flow.start();
  return flow;
}

contractTest(
  "a restart converges terminal Discord paint before admitting the next queued turn",
  async () => {
    const redis = contractRedis();
    const store = conversations(redis);
    const queue = store.queue;
    const renderStore = store.render;
    const discord = new MemoryDiscord();
    const sent: DeliveryPayload[] = [];
    const client = createAdmissionClient(redis, sent);
    const beforeRestart = await startBotRuntime(redis, store, discord, client);

    const first = message("40000000000000010", "first");
    const second = message("40000000000000011", "second");
    expect(await beforeRestart.submit(first)).toEqual(Result.ok(undefined));
    expect(await beforeRestart.submit(second)).toEqual(Result.ok(undefined));
    expect(sent).toHaveLength(1);

    const delivery = sent[0];
    if (delivery === undefined) throw new Error("first delivery was not admitted");
    const publisher = createRenderPublisher({
      store: conversations(redis).renderPublication,
      botUrl: "http://bot.invalid",
      botSecret: "contract-secret",
      fetch: callbackFetch,
    });
    const streaming: RenderIntent = {
      dispatchId: delivery.dispatchId,
      continuationKey: delivery.continuationKey,
      messageId: delivery.messageId,
      sessionId: "session-1",
      eveTurnId: "turn-1",
      revision: 1,
      phase: "streaming",
      text: "partial answer",
      activity: "Working",
    };
    const callbackLog = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await publisher.publish(streaming)).toBe(true);
      expect(callbackLog).toHaveBeenCalledTimes(1);
    } finally {
      callbackLog.mockRestore();
    }
    await beforeRestart.sweep();
    await waitUntil(async () => {
      const projection = await renderStore.projection(delivery.dispatchId);
      return Result.isOk(projection) && projection.value.appliedRevision === 1;
    }, "the streaming projection");

    await beforeRestart.stop();

    const parked: ParkedPayload = {
      continuationKey: delivery.continuationKey,
      sessionId: "session-1",
      messageId: delivery.messageId,
      dispatchId: delivery.dispatchId,
      eveTurnId: "turn-1",
    };
    const terminal: RenderIntent = {
      ...streaming,
      revision: 2,
      phase: "completed",
      text: "final answer",
      activity: "",
      footer: "done",
    };
    expect(await publisher.settleAndPark(terminal, parked)).toBe(2);
    expect(await queue.complete(parked)).toBe("pending");
    expect(sent).toHaveLength(1);

    const recovered = await startBotRuntime(redis, store, discord, client);
    try {
      await recovered.sweep();

      expect(await renderStore.outcome(delivery.dispatchId)).toBe("applied");
      expect(sent).toHaveLength(2);
      expect(sent[1]?.messageId).toBe(second.messageId);
      expect([...discord.messages.values()]).toEqual(["final answer\n-# done"]);
    } finally {
      await recovered.stop();
      await queue.purge(first.continuationKey);
    }
  },
  30_000,
);
