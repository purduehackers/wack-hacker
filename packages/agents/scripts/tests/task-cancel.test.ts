import { afterEach, expect, test } from "bun:test";

import { createConversationStore } from "@repo/shared/conversations";
import type { ConversationStore } from "@repo/shared/conversations";
import { getRedis } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import type { Reporter } from "@repo/shared/result/observe";
import { decodeCancelRequestPayload, decodeRenderIntent } from "@repo/shared/wire";
import type { CancelRequestPayload, CancelResponse, RenderIntent } from "@repo/shared/wire";

import { createAgentClient } from "../../../bot/src/agent/client.ts";
import type { AgentError } from "../../../bot/src/agent/client.ts";
import { createDiscordRest } from "../../../bot/src/agent/render/discord-rest.ts";
import { createCancellationRecovery } from "../../../bot/src/utils/conversation/cancel.ts";
import { createConversationFlow } from "../../../bot/src/utils/conversation/index.ts";
import { applyLatest } from "../../../bot/src/utils/conversation/render.ts";
import { probeMessage, scrubProbe } from "../../../shared/scripts/probe.ts";
import {
  activeKey,
  AGENT_CANCEL_READY_SET_KEY,
  renderMember,
  renderProjectionKey,
  taskControlKey,
} from "../../../shared/src/conversations/keys.ts";
import {
  cancelDiscordTask,
  EXACT_TURN_CANCEL_SUPPORTED,
} from "../../agent/lib/discord/cancellation.ts";

const redisUrl = process.env["REDIS_TEST_URL"];
const redisTest = test.skipIf(redisUrl === undefined);
const runs: { key: string; ids: Set<string> }[] = [];
function testRedis() {
  if (redisUrl === undefined || !/^redis:\/\/(?:127\.0\.0\.1|localhost):/u.test(redisUrl)) {
    throw new Error("Cancellation tests require an explicit local REDIS_TEST_URL");
  }
  return getRedis({ url: redisUrl });
}
afterEach(async () => {
  if (runs.length === 0) return;
  const redis = testRedis();
  for (const run of runs.splice(0)) {
    for (const id of run.ids) {
      await redis.del(taskControlKey(id));
      await redis.srem(AGENT_CANCEL_READY_SET_KEY, renderMember(id));
    }
    await scrubProbe(redis, run.key, run.ids);
  }
});

async function fixture(held = false) {
  const redis = testRedis();
  const store = createConversationStore({ redis });
  const key = `999${BigInt(`0x${crypto.randomUUID().replaceAll("-", "").slice(0, 11)}`)
    .toString()
    .padStart(15, "0")}`;
  const message = probeMessage(
    {
      continuationKey: key,
      messageId: "99999999999999701",
      userId: "99999999999999702",
    },
    "Stop exactly this task",
  );
  await store.delivery.enqueue(message);
  const claimed = await store.delivery.claim(key);
  if (Result.isError(claimed) || claimed.value === undefined) throw new Error("No test delivery");
  const { dispatchId } = claimed.value.payload;
  runs.push({ key, ids: new Set([dispatchId]) });
  const admission = await store.delivery.markLive(key, dispatchId, message.messageId);
  if (admission.status !== "start") throw new Error("No test admission");
  await store.delivery.confirmSession(key, dispatchId, message.messageId, "session-cancel-test");
  await store.delivery.releaseIngress(key, admission.attempt);
  const intent: RenderIntent = {
    dispatchId,
    continuationKey: key,
    messageId: message.messageId,
    sessionId: "session-cancel-test",
    eveTurnId: "turn-one",
    revision: 1,
    phase: "streaming",
    text: "One action has already completed.",
    activity: "Checking",
    ...(held
      ? {
          inputRequests: [
            {
              requestId: "approval",
              recipientUserId: message.principal.userId,
              kind: "tool-approval" as const,
              prompt: "Approve another action?",
            },
          ],
        }
      : {}),
  };
  await store.render.publish(intent, {});
  const claimToken = await store.render.claim(dispatchId);
  if (claimToken === undefined) throw new Error("No render claim");
  await store.render.complete({
    dispatchId,
    claimToken,
    projection: { anchorMessageId: "99999999999999703", overflow: [] },
    appliedRevision: 1,
    terminal: false,
  });
  const payload: CancelRequestPayload = {
    continuationKey: key,
    dispatchId,
    sessionId: intent.sessionId,
    eveTurnId: intent.eveTurnId,
    renderRevision: 1,
    anchorMessageId: "99999999999999703",
    channelId: key,
    interactionId: "99999999999999704",
    principal: message.principal,
  };
  return { redis, store, intent, payload };
}

function renderingDeps(store: ConversationStore, reporter: Reporter, painted: unknown[]) {
  const client = createAgentClient({ baseUrl: "http://127.0.0.1:1", secret: "unused" });
  return {
    store,
    reporter,
    rest: createDiscordRest({
      patch: async (_path, options) => {
        painted.push(options?.body);
      },
      post: async () => {
        throw new Error("The existing anchor should be edited");
      },
      delete: async () => undefined,
    }),
    eve: {
      ...client,
      prepareContinuation: async () => Result.ok(undefined),
      streamAccess: async () => Result.ok(client),
    },
    turnMessages: { record: async () => Result.ok(undefined) },
    schedules: {
      admit: async () => {
        throw new Error("No schedule should run");
      },
    },
  };
}

redisTest(
  "cancellation intent is durable, bounded, and idempotent without declaring completion",
  async () => {
    const f = await fixture(true);
    expect(await f.store.cancellations.request(f.payload)).toBe("pending");
    expect(await f.store.cancellations.request(f.payload)).toBe("pending");
    const restarted = createConversationStore({ redis: f.redis });
    expect(await restarted.cancellations.pending()).toContain(f.payload.dispatchId);
    expect(await f.redis.pttl(taskControlKey(f.payload.dispatchId))).toBeGreaterThan(0);
    const desired = await restarted.renders.intent(f.payload.dispatchId);
    expect(Result.isOk(desired) && desired.value?.revision).toBe(2);
    expect(Result.isOk(desired) && desired.value?.phase).toBe("streaming");
    expect(Result.isOk(desired) && Result.isOk(decodeRenderIntent(desired.value))).toBe(true);
    expect(await restarted.renders.outcome(f.payload.dispatchId)).toBeUndefined();
    expect((await restarted.deliveries.read(f.payload.continuationKey))?.phase).toBe("live");
    expect((await restarted.cancellations.read(f.payload.dispatchId))?.outcome).toBeUndefined();
  },
);

redisTest(
  "first competing click owns the durable command; later interaction ids never replace it",
  async () => {
    const f = await fixture();
    const other = { ...f.payload, interactionId: "99999999999999705" };
    const results = await Promise.all([
      f.store.cancellations.request(f.payload),
      f.store.cancellations.request(other),
    ]);
    expect(results).toEqual(["pending", "pending"]);
    const saved = await f.store.cancellations.read(f.payload.dispatchId);
    expect(saved?.request?.payload.interactionId).toBeOneOf([
      f.payload.interactionId,
      other.interactionId,
    ]);
    expect(
      (await f.store.cancellations.pending()).filter((id) => id === f.payload.dispatchId),
    ).toHaveLength(1);
  },
);

redisTest(
  "exact revision, current anchor, requester and all target coordinates fail closed",
  async () => {
    const f = await fixture();
    for (const payload of [
      { ...f.payload, renderRevision: 2 },
      { ...f.payload, anchorMessageId: "99999999999999799" },
      { ...f.payload, sessionId: "other-session" },
      { ...f.payload, eveTurnId: "other-turn" },
      { ...f.payload, channelId: "99999999999999798" },
      { ...f.payload, principal: { ...f.payload.principal, userId: "99999999999999797" } },
    ])
      expect(await f.store.cancellations.request(payload)).toBe("stale");
    await f.redis.del(renderProjectionKey(f.payload.dispatchId));
    expect(await f.store.cancellations.request(f.payload)).toBe("stale");
  },
);

redisTest(
  "completion before admission is refused; a delayed request cannot target a newer dispatch",
  async () => {
    const f = await fixture();
    const parked = {
      continuationKey: f.intent.continuationKey,
      dispatchId: f.intent.dispatchId,
      messageId: f.intent.messageId,
      sessionId: f.intent.sessionId,
      eveTurnId: f.intent.eveTurnId,
    };
    await f.store.render.settleAndPark(
      { ...f.intent, revision: 2, phase: "completed" },
      parked,
      {},
    );
    expect(await f.store.cancellations.request(f.payload)).toBe("stale");

    const second = await fixture();
    expect(await second.store.cancellations.request(second.payload)).toBe("pending");
    const record = await second.store.deliveries.read(second.payload.continuationKey);
    if (record === undefined) throw new Error("No delivery");
    await second.redis.set(
      activeKey(second.payload.continuationKey),
      {
        ...record,
        dispatchId: crypto.randomUUID(),
        sessionId: "newer-session",
      },
      { keepTtl: true },
    );
    expect(await second.store.cancellations.authorize(second.payload)).toBe("stale");
    let called = false;
    expect(
      await cancelDiscordTask(
        second.store.cancellations,
        {
          supported: true,
          attachSession: () => ({
            cancel: async () => {
              called = true;
              return { status: "no_active_turn" };
            },
          }),
        },
        second.payload,
      ),
    ).toEqual({ ok: true, status: "stale" });
    expect(called).toBe(false);
  },
);

redisTest(
  "HTTP acknowledgement loss replays the receipt, never marks Cancelled, and preserves held approval",
  async () => {
    const f = await fixture(true);
    await f.store.cancellations.request(f.payload);
    const calls: unknown[] = [];
    let attempts = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const parsed = decodeCancelRequestPayload(await request.json());
        if (Result.isError(parsed)) throw parsed.error;
        const response = await cancelDiscordTask(
          f.store.cancellations,
          {
            supported: true,
            attachSession: (sessionId) => ({
              cancel: async (options) => {
                calls.push({ sessionId, options });
                return { status: "accepted", sessionId };
              },
            }),
          },
          parsed.value,
        );
        attempts += 1;
        return attempts === 1
          ? new Response("lost upstream acknowledgement", { status: 503 })
          : Response.json(response);
      },
    });
    try {
      const client = createAgentClient({ baseUrl: server.url.toString(), secret: "local-test" });
      const response = await client.sendCancel(f.payload);
      if (Result.isError(response)) throw response.error;
      expect(Result.isOk(response) && response.value.status).toBe("accepted");
      expect(attempts).toBe(2);
      expect(calls).toEqual([
        { sessionId: f.payload.sessionId, options: { turnId: f.payload.eveTurnId } },
      ]);
      expect((await f.store.cancellations.read(f.payload.dispatchId))?.outcome).toBeUndefined();
      const desired = await f.store.renders.intent(f.payload.dispatchId);
      expect(Result.isOk(desired) && desired.value?.inputRequests?.[0]?.requestId).toBe("approval");
      expect((await f.store.deliveries.read(f.payload.continuationKey))?.phase).toBe("live");
    } finally {
      await server.stop(true);
    }
  },
);

redisTest(
  "a turn ending after admission cannot be cancelled; live input ingress refuses Stop",
  async () => {
    const f = await fixture(true);
    const active = await f.store.deliveries.read(f.payload.continuationKey);
    if (active === undefined) throw new Error("No delivery");
    await f.redis.set(
      activeKey(f.payload.continuationKey),
      { ...active, ingress: { holder: "answering", expiresAtMs: Date.now() + 30_000 } },
      { keepTtl: true },
    );
    expect(await f.store.cancellations.request(f.payload)).toBe("busy");
    await f.redis.set(activeKey(f.payload.continuationKey), active, { keepTtl: true });
    expect(await f.store.cancellations.request(f.payload)).toBe("pending");
    await f.store.render.settleAndPark(
      { ...f.intent, phase: "completed", revision: 3, inputRequests: [] },
      {
        continuationKey: f.intent.continuationKey,
        dispatchId: f.intent.dispatchId,
        messageId: f.intent.messageId,
        sessionId: f.intent.sessionId,
        eveTurnId: f.intent.eveTurnId,
      },
      {},
    );
    const outcome = await cancelDiscordTask(
      f.store.cancellations,
      {
        supported: true,
        attachSession: () => {
          throw new Error("Completed work must not receive a cancel command");
        },
      },
      f.payload,
    );
    expect(outcome.status).toBe("no-active-turn");
    expect((await f.store.cancellations.read(f.payload.dispatchId))?.outcome).toBeUndefined();
    const desired = await f.store.renders.intent(f.payload.dispatchId);
    expect(Result.isOk(desired) && desired.value?.revision).toBe(3);
    expect(await f.store.renders.outcome(f.payload.dispatchId)).toBeUndefined();
  },
);

redisTest(
  "only authoritative cancellation settlement removes held controls and passes the terminal visibility barrier",
  async () => {
    const f = await fixture(true);
    await f.store.cancellations.request(f.payload);
    const parked = {
      continuationKey: f.intent.continuationKey,
      dispatchId: f.intent.dispatchId,
      messageId: f.intent.messageId,
      sessionId: f.intent.sessionId,
      eveTurnId: f.intent.eveTurnId,
    };
    const { inputRequests: _requests, ...terminal } = f.intent;
    const revision = await f.store.render.settleAndPark(
      {
        ...terminal,
        phase: "completed",
        revision: 2,
      },
      parked,
      { outcome: "cancelled" },
    );
    expect(revision).toBe(3);
    expect((await f.store.cancellations.read(f.payload.dispatchId))?.outcome).toBe("cancelled");
    expect(await f.store.delivery.complete(parked)).not.toBe("completed");
    const claimToken = await f.store.render.claim(f.payload.dispatchId);
    if (claimToken === undefined || revision === undefined) throw new Error("No render ownership");
    await f.store.render.complete({
      dispatchId: f.payload.dispatchId,
      claimToken,
      projection: { anchorMessageId: f.payload.anchorMessageId, overflow: [] },
      appliedRevision: revision,
      terminal: true,
    });
    await f.store.delivery.complete(parked);
    expect(await f.store.deliveries.read(f.payload.continuationKey)).toBeUndefined();
  },
);

redisTest("empty arrays and quoted revision text survive cancellation publication", async () => {
  const f = await fixture();
  const tricky: RenderIntent = {
    ...f.intent,
    text: 'The text says "revision": 42 and must stay intact.',
    authorizations: [],
    inputRequests: [
      {
        requestId: "question",
        kind: "question",
        prompt: '"revision": 900',
        recipientUserId: f.payload.principal.userId,
        options: [],
        allowFreeform: true,
      },
    ],
  };
  await f.redis.set(`agent:render-intent:${f.payload.dispatchId}`, JSON.stringify(tricky), {
    keepTtl: true,
  });
  await f.store.cancellations.request(f.payload);
  await f.store.cancellations.acknowledge(f.payload, "accepted");
  const updated = await f.store.renders.intent(f.payload.dispatchId);
  expect(Result.isOk(updated) && updated.value).toEqual({ ...tricky, revision: 3 });
  expect(
    (await f.store.cancellations.read(f.payload.dispatchId))?.request?.payload.principal
      .memberRoles,
  ).toEqual([]);
});

redisTest(
  "corrupt control metadata does not block final rendering or unrelated cancellation recovery",
  async () => {
    const broken = await fixture();
    const healthy = await fixture();
    await broken.store.cancellations.request(broken.payload);
    await healthy.store.cancellations.request(healthy.payload);
    await broken.redis.set(
      taskControlKey(broken.payload.dispatchId),
      { corrupt: true },
      { keepTtl: true },
    );
    const defects: unknown[] = [];
    const calls: CancelRequestPayload[] = [];
    const reporter = {
      emit: () => undefined,
      captureDefect: (cause: unknown) => {
        defects.push(cause);
      },
    };
    const recovery = createCancellationRecovery(
      {
        store: createConversationStore({ redis: broken.redis }),
        reporter,
        eve: {
          supportsCancel: async () => true,
          sendCancel: async (payload) => {
            calls.push(payload);
            return Result.ok({ ok: true, status: "accepted" });
          },
        },
      },
      () => false,
    );
    recovery.wake();
    await recovery.drain();
    expect(calls).toContainEqual(healthy.payload);
    expect(calls).not.toContainEqual(broken.payload);
    expect(defects).toHaveLength(1);
    const parked = {
      continuationKey: broken.intent.continuationKey,
      dispatchId: broken.intent.dispatchId,
      messageId: broken.intent.messageId,
      sessionId: broken.intent.sessionId,
      eveTurnId: broken.intent.eveTurnId,
    };
    await broken.redis.set(taskControlKey(broken.payload.dispatchId), "{broken", {
      keepTtl: true,
    });
    await broken.store.render.settleAndPark(
      {
        ...broken.intent,
        phase: "completed",
        revision: 5,
      },
      parked,
      { outcome: "cancelled" },
    );
    const painted: unknown[] = [];
    expect(
      await applyLatest(renderingDeps(broken.store, reporter, painted), broken.payload.dispatchId),
    ).toBe("done");
    expect(painted).toHaveLength(1);
    expect(JSON.stringify(painted)).toContain(broken.intent.text);
    expect(await broken.store.renders.outcome(broken.payload.dispatchId)).toBe("applied");
    await broken.store.delivery.complete(parked);
    expect(await broken.store.deliveries.read(broken.payload.continuationKey)).toBeUndefined();
    expect(defects).toHaveLength(2);
  },
);

redisTest("a stuck Stop delivery cannot block other final answers or later recovery", async () => {
  const stuck = await fixture();
  const ready = await fixture();
  await stuck.store.cancellations.request(stuck.payload);
  const parked = {
    continuationKey: ready.intent.continuationKey,
    dispatchId: ready.intent.dispatchId,
    messageId: ready.intent.messageId,
    sessionId: ready.intent.sessionId,
    eveTurnId: ready.intent.eveTurnId,
  };
  await ready.store.render.settleAndPark(
    { ...ready.intent, phase: "completed", revision: 2 },
    parked,
  );
  const waiting = Promise.withResolvers<Result<CancelResponse, AgentError>>();
  const calls: string[] = [];
  const defects: unknown[] = [];
  const painted: unknown[] = [];
  const deps = renderingDeps(
    stuck.store,
    { emit: () => undefined, captureDefect: (cause: unknown) => void defects.push(cause) },
    painted,
  );
  const flow = createConversationFlow({
    ...deps,
    eve: {
      ...deps.eve,
      supportsCancel: async () => true,
      sendCancel: async (payload) => {
        calls.push(payload.dispatchId);
        if (payload.dispatchId === stuck.payload.dispatchId) return waiting.promise;
        return Result.ok({ ok: true, status: "accepted" });
      },
    },
  });
  try {
    // start must return after painting the final answer even though Stop has
    // deliberately never returned. Duplicate sweeps must not resend that Stop.
    await flow.start();
    await flow.sweep();
    expect(calls.filter((id) => id === stuck.payload.dispatchId)).toHaveLength(1);
    expect(await ready.store.renders.outcome(ready.payload.dispatchId)).toBe("applied");
    expect(await ready.store.deliveries.read(ready.payload.continuationKey)).toBeUndefined();
    const later = await fixture();
    await later.store.cancellations.request(later.payload);
    await flow.sweep();
    // The free slot accepts a later task while the first remains unresolved.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (
        (await later.store.cancellations.read(later.payload.dispatchId))?.request?.status ===
        "accepted"
      )
        break;
      await Bun.sleep(1);
    }
    expect((await later.store.cancellations.read(later.payload.dispatchId))?.request?.status).toBe(
      "accepted",
    );
    expect(calls.filter((id) => id === stuck.payload.dispatchId)).toHaveLength(1);
    expect(defects).toHaveLength(0);
  } finally {
    waiting.resolve(Result.ok({ ok: true, status: "accepted" }));
    await flow.stop();
  }
});

test("unsupported installed backend refuses cancellation before any execution or mutation", async () => {
  expect(EXACT_TURN_CANCEL_SUPPORTED).toBe(false);
  let touched = false;
  const f = {
    authorize: async () => {
      touched = true;
      return "pending" as const;
    },
    acknowledge: async () => {
      touched = true;
    },
  };
  // The production gate is checked before the command store is read.
  const response = await cancelDiscordTask(
    f,
    {
      supported: EXACT_TURN_CANCEL_SUPPORTED,
      attachSession: () => {
        touched = true;
        throw new Error("Must not reach Eve");
      },
    },
    {
      continuationKey: "99999999999999700",
      channelId: "99999999999999700",
      anchorMessageId: "99999999999999701",
      interactionId: "99999999999999702",
      dispatchId: crypto.randomUUID(),
      sessionId: "session",
      eveTurnId: "turn",
      renderRevision: 1,
      principal: {
        userId: "99999999999999703",
        username: "requester",
        nickname: "requester",
        memberRoles: [],
      },
    },
  );
  expect(response).toEqual({ ok: true, status: "unsupported" });
  expect(touched).toBe(false);
});
