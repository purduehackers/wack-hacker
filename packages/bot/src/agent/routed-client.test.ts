import { afterAll, beforeAll, expect, test } from "bun:test";

import {
  createConversationStore,
  EXECUTION_GENERATION_HEADER,
  EXECUTION_PROBE_ROUTE,
  type ConversationStore,
  type ExecutionIdentity,
} from "@repo/shared/conversations";
import { messageOf, UpstreamError } from "@repo/shared/errors";
import { closeRedis, getRedis, type RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import {
  WIRE_ROUTES,
  decodeDeliveryPayload,
  decodeInteractionPayload,
  decodeResetRequestPayload,
  decodeSteerRequestPayload,
  decodeCancelRequestPayload,
  type DeliveryPayload,
  type CancelRequestPayload,
} from "@repo/shared/wire";

import { createExecutionBridge } from "../../../agents/agent/lib/discord/execution-bridge.ts";
import { submitMessage } from "../utils/conversation/queue.ts";
import { createExecutionStreamClient } from "./execution-stream.ts";
import { parseExecutionTargets, type ExecutionTargets } from "./execution-targets.ts";
import { createRoutedCancellation } from "./routed-cancellation.ts";
import { createRoutedAgentClient, createRouteResolver } from "./routed-client.ts";

const url = process.env["REDIS_TEST_URL"];
const secret = "local-routing-test-secret";
const principal = {
  userId: "100000000000000003",
  username: "tester",
  nickname: "tester",
  memberRoles: [],
};
let redis: RedisClient;
let store: ConversationStore;
const cleanup: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
function address(): string {
  const key = String(
    200000000000000000n + BigInt(crypto.getRandomValues(new Uint32Array(1))[0] ?? 0),
  );
  cleanup.push(`agent:execution:${key}`, `agent:reset:${key}`);
  return key;
}
function delivery(continuationKey: string): DeliveryPayload {
  const dispatchId = crypto.randomUUID();
  cleanup.push(`agent:dispatch-execution:${dispatchId}`);
  const parsed = decodeDeliveryPayload({
    kind: "mention",
    continuationKey,
    dispatchId,
    content: "Read the attached context",
    messageId: "100000000000000002",
    principal,
    channel: { id: continuationKey, name: "test" },
    attachments: [
      { url: "https://cdn.discordapp.com/attachments/test.txt", filename: "test.txt", size: 12 },
    ],
  });
  if (Result.isError(parsed)) throw parsed.error;
  return parsed.value;
}

function streamFixture(): Response {
  return new Response(
    JSON.stringify({
      type: "session.waiting",
      data: { continuationToken: "session", wait: "next-user-message" },
      meta: { id: "event-one", at: "2026-10-20T00:00:00.000Z" },
    }) + "\n",
    {
      headers: {
        "Content-Type": "application/x-ndjson",
        "x-eve-stream-version": "26",
        "x-eve-stream-format": "ndjson",
        "x-eve-stream-tail-index": "0",
      },
    },
  );
}

function decodeRoutePayload(route: string, body: unknown) {
  if (route === WIRE_ROUTES.message) return decodeDeliveryPayload(body);
  if (route === WIRE_ROUTES.interaction) return decodeInteractionPayload(body);
  if (route === WIRE_ROUTES.reset) return decodeResetRequestPayload(body);
  if (route === WIRE_ROUTES.cancel) return decodeCancelRequestPayload(body);
  return decodeSteerRequestPayload(body);
}

async function guardCommand(
  bridge: ReturnType<typeof createExecutionBridge>,
  request: Request,
  route: string,
  body: unknown,
  continuationKey: string,
) {
  if (route !== WIRE_ROUTES.cancel) return bridge.guard(request, continuationKey);
  const command = decodeCancelRequestPayload(body);
  if (Result.isError(command)) return new Response("invalid cancellation", { status: 400 });
  return bridge.guardTask(request, command.value);
}

function deployment(identity: ExecutionIdentity) {
  const sessions = new Map<string, string>();
  const calls: {
    route: string;
    key: string;
    generation: string | undefined;
    body?: string;
  }[] = [];
  const receivedPaths: string[] = [];
  let probeStatus = 200;
  let cancelResponseLosses = 0;
  const bridge = createExecutionBridge({ store, identity: () => identity });
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const streamPath = new URL(request.url).pathname;
      if (request.method === "GET" && streamPath.endsWith("/stream")) {
        calls.push({ route: streamPath, key: "stream", generation: undefined });
        return streamFixture();
      }
      if (request.headers.get("authorization") !== `Bearer ${secret}`)
        return new Response("unauthorized", { status: 401 });
      const route = new URL(request.url).pathname;
      receivedPaths.push(route);
      if (route === EXECUTION_PROBE_ROUTE) {
        if (probeStatus !== 200) return new Response("lookup unavailable", { status: probeStatus });
        return bridge.probe(request, async (key) => {
          const id = sessions.get(key);
          return id === undefined ? undefined : { id };
        });
      }
      const rawBody = await request.text();
      const body: unknown = JSON.parse(rawBody);
      const decoded = decodeRoutePayload(route, body);
      if (Result.isError(decoded)) return new Response("invalid", { status: 400 });
      const key = decoded.value.continuationKey;
      const guarded = await guardCommand(bridge, request, route, body, key);
      if (guarded instanceof Response) return guarded;
      calls.push({
        route,
        key,
        generation: request.headers.get(EXECUTION_GENERATION_HEADER) ?? undefined,
        body: rawBody,
      });
      if (route === WIRE_ROUTES.cancel) {
        if (cancelResponseLosses > 0) {
          cancelResponseLosses -= 1;
          return new Response("lost acknowledgement", { status: 503 });
        }
        return Response.json({ ok: true, status: "accepted" });
      }
      if (route === WIRE_ROUTES.streamToken) return Response.json({ token: "local-stream-token" });
      if (route === WIRE_ROUTES.steer) return Response.json({ ok: true, status: "accepted" });
      if (route === WIRE_ROUTES.reset) {
        sessions.delete(key);
        return Response.json({ ok: true, status: "reset" });
      }
      const sessionId = sessions.get(key) ?? `${identity.id}-${crypto.randomUUID()}`;
      sessions.set(key, sessionId);
      if (route === WIRE_ROUTES.message) {
        const message = decodeDeliveryPayload(body);
        const held = await store.deliveries.read(key);
        if (Result.isOk(message) && held?.dispatchId === message.value.dispatchId) {
          await store.delivery.markLive(key, message.value.dispatchId, message.value.messageId);
          await store.delivery.confirmSession(
            key,
            message.value.dispatchId,
            message.value.messageId,
            sessionId,
          );
        }
      }
      return Response.json({ ok: true, sessionId, continuationToken: key });
    },
  });
  servers.push(server);
  return {
    sessions,
    calls,
    requests: receivedPaths,
    origin: server.url.origin,
    identity,
    setProbeStatus: (status: number) => {
      probeStatus = status;
    },
    loseCancelResponses: (count: number) => {
      cancelResponseLosses = count;
    },
  };
}

function fixture(runtime = "eve-0.81.1") {
  const legacy = deployment({
    id: "retained-legacy",
    projectId: "legacy-project",
    runtime: "eve-0.31.3",
    sandbox: "vercel-sandbox-v1",
  });
  const current = deployment({
    id: "candidate",
    projectId: "candidate-project",
    runtime,
    sandbox: "durable-bash-v1",
  });
  const config = parseExecutionTargets(
    JSON.stringify({
      legacy: legacy.identity.id,
      current: current.identity.id,
      targets: [legacy, current].map(({ identity, origin }) => ({
        identity,
        origin,
        enabled: true,
        capabilities: ["session-affinity-v1"],
      })),
    }),
  );
  const client = (configuration: ExecutionTargets = config) =>
    createRoutedAgentClient({ store, config: configuration, secret });
  return { legacy, current, config, client };
}

function offerCancellation(config: ExecutionTargets): ExecutionTargets {
  return {
    ...config,
    targets: config.targets.map((target) => ({
      ...target,
      capabilities: [...target.capabilities, "exact-turn-cancel-v1"],
    })),
  };
}

async function stopPayload(payload: DeliveryPayload): Promise<CancelRequestPayload> {
  const bound = await store.executions.dispatch(payload.dispatchId);
  if (Result.isError(bound) || bound.value?.sessionId === undefined)
    throw new Error("The task has no bound session");
  return {
    continuationKey: payload.continuationKey,
    dispatchId: payload.dispatchId,
    sessionId: bound.value.sessionId,
    eveTurnId: "original-turn",
    renderRevision: 7,
    anchorMessageId: "100000000000000010",
    channelId: payload.channel.id,
    interactionId: "100000000000000011",
    principal,
  };
}

/** Simulated future runtime only; the public adapter's production allowlist stays empty. */
function verifiedTestRouter(config: ExecutionTargets) {
  const resolve = createRouteResolver({ store, config, secret });
  return createRoutedCancellation({
    resolve: (target) =>
      Result.tryPromise({
        try: () => resolve(target, false),
        catch: (cause) =>
          new UpstreamError({ service: "test routing", status: 503, detail: messageOf(cause) }),
      }),
    isRuntimeVerified: (runtime) => runtime === "eve-9.99.0",
  });
}

beforeAll(() => {
  if (url === undefined) return;
  redis = getRedis({ url });
  store = createConversationStore({ redis });
});
afterAll(async () => {
  for (const server of servers) await server.stop(true);
  if (cleanup.length > 0) await redis.del(...cleanup);
  await closeRedis();
});

test.skipIf(url === undefined)(
  "unversioned idle legacy session and attachments stay on legacy across promotion and restart",
  async () => {
    const f = fixture();
    const payload = delivery(address());
    f.legacy.sessions.set(payload.continuationKey, "existing-old-session");
    expect(Result.isOk(await f.client().sendMessage(payload))).toBe(true);
    expect(Result.isOk(await f.client().sendMessage({ ...payload, kind: "followup" }))).toBe(true);
    expect(f.legacy.calls.map(({ route }) => route)).toEqual([
      WIRE_ROUTES.message,
      WIRE_ROUTES.message,
    ]);
    expect(f.current.calls).toHaveLength(0);
    const binding = await store.executions.read(payload.continuationKey);
    expect(Result.isOk(binding) && binding.value?.sessionId).toBe("existing-old-session");
  },
);

test.skipIf(url === undefined)(
  "verified new work, pending answers and stream credentials retain candidate across rollback",
  async () => {
    const f = fixture();
    const payload = delivery(address());
    expect(Result.isOk(await f.client().sendMessage(payload))).toBe(true);
    const rollback = f.client({ ...f.config, current: f.config.legacy });
    expect(
      Result.isOk(
        await rollback.sendInteraction({
          continuationKey: payload.continuationKey,
          dispatchId: payload.dispatchId,
          interactionId: "100000000000000004",
          renderRevision: 2,
          requestId: "approval",
          authChannelId: payload.channel.id,
          optionId: "approve",
          principal: payload.principal,
        }),
      ),
    ).toBe(true);
    expect(
      Result.isOk(await rollback.sendSteer({ continuationKey: payload.continuationKey })),
    ).toBe(true);
    const stream = await rollback.streamAccess(payload);
    if (Result.isError(stream)) throw stream.error;
    expect(stream.value.baseUrl).toBe(`${f.current.origin}/`);
    expect(Result.isOk(await stream.value.streamToken())).toBe(true);
    expect(f.legacy.calls).toHaveLength(0);
    expect(f.current.calls.map(({ route }) => route)).toEqual([
      WIRE_ROUTES.message,
      WIRE_ROUTES.interaction,
      WIRE_ROUTES.steer,
      WIRE_ROUTES.streamToken,
    ]);
  },
);

test.skipIf(url === undefined)(
  "missing or revoked target refuses all requests instead of falling back",
  async () => {
    const f = fixture();
    const payload = delivery(address());
    await f.client().sendMessage(payload);
    const missing = f.client({
      ...f.config,
      current: f.config.legacy,
      targets: f.config.targets.filter(({ identity }) => identity.id !== f.config.current),
    });
    expect(Result.isError(await missing.sendMessage(payload))).toBe(true);
    expect(Result.isError(await missing.streamAccess(payload))).toBe(true);
    expect(f.current.calls).toHaveLength(1);
    expect(f.legacy.calls).toHaveLength(0);
  },
);

test.skipIf(url === undefined)(
  "404 and failed ownership probes never create replacement sessions or bindings",
  async () => {
    const f = fixture();
    for (const status of [404, 500]) {
      const payload = delivery(address());
      f.legacy.setProbeStatus(status);
      expect(Result.isError(await f.client().sendMessage(payload))).toBe(true);
      const binding = await store.executions.read(payload.continuationKey);
      expect(Result.isOk(binding) && binding.value).toBeUndefined();
    }
    expect(f.legacy.calls).toHaveLength(0);
    expect(f.current.calls).toHaveLength(0);
  },
);

test.skipIf(url === undefined)(
  "explicit reset retires on the bound host and old dispatch callbacks cannot reach its next session",
  async () => {
    const f = fixture();
    const payload = delivery(address());
    const client = f.client();
    await client.sendMessage(payload);
    const resetId = crypto.randomUUID();
    await redis.set(`agent:reset:${payload.continuationKey}`, resetId, { ex: 60 });
    expect(
      Result.isOk(
        await client.sendReset({
          continuationKey: payload.continuationKey,
          resetId,
          reason: "user requested new conversation",
          principal: payload.principal,
        }),
      ),
    ).toBe(true);
    expect(Result.isError(await client.streamAccess(payload))).toBe(true);
    expect(Result.isError(await client.sendMessage(payload))).toBe(true);
    const next = delivery(payload.continuationKey);
    expect(
      Result.isOk(await f.client({ ...f.config, current: f.config.legacy }).sendMessage(next)),
    ).toBe(true);
    expect(f.legacy.calls).toHaveLength(0);
    expect(f.current.calls.map(({ route }) => route)).toEqual([
      WIRE_ROUTES.message,
      WIRE_ROUTES.reset,
      WIRE_ROUTES.message,
    ]);
  },
);

test.skipIf(url === undefined)(
  "root and local-child NDJSON streams and every renewed token use the bound origin",
  async () => {
    const f = fixture();
    const payload = delivery(address());
    const delivered = await f.client().sendMessage(payload);
    if (Result.isError(delivered)) throw delivered.error;
    const stream = await createExecutionStreamClient(
      f.client({ ...f.config, current: f.config.legacy }),
      payload,
    );
    for (const sessionId of [delivered.value.sessionId, "child-session"]) {
      const events = [];
      for await (const frame of stream.sessions
        .attach(sessionId, { streamIndex: 0 })
        .stream({ follow: false, streamReconnectPolicy: { reconnect: false } }))
        events.push(frame.type);
      expect(events).toEqual(["session.waiting"]);
    }
    expect(f.current.calls.filter(({ route }) => route === WIRE_ROUTES.streamToken)).toHaveLength(
      2,
    );
    expect(f.current.calls.filter(({ route }) => route.endsWith("/stream"))).toHaveLength(2);
    expect(f.legacy.calls).toHaveLength(0);
  },
);

test.skipIf(url === undefined)(
  "unversioned ingress cannot race the bridge's absence probe and binding",
  async () => {
    const f = fixture();
    const payload = delivery(address());
    const unbound = await fetch(new URL(WIRE_ROUTES.message, f.legacy.origin), {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(unbound.status).toBe(409);
    expect(Result.isOk(await f.client().sendMessage(payload))).toBe(true);
    const legacyAttempt = await fetch(new URL(WIRE_ROUTES.message, f.legacy.origin), {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(legacyAttempt.status).toBe(409);
    expect(f.legacy.sessions.size).toBe(0);
    expect(f.current.sessions.size).toBe(1);
  },
);

test.skipIf(url === undefined)(
  "queue acceptance pins current before enqueue and restart cannot switch it",
  async () => {
    const f = fixture();
    const payload = delivery(address());
    expect(Result.isOk(await f.client().prepareContinuation(payload))).toBe(true);
    expect(f.current.calls).toHaveLength(0);
    const rollback = f.client({ ...f.config, current: f.config.legacy });
    expect(Result.isOk(await rollback.sendMessage(payload))).toBe(true);
    expect(f.current.calls.map(({ route }) => route)).toEqual([WIRE_ROUTES.message]);
    expect(f.legacy.calls).toHaveLength(0);
  },
);

test.skipIf(url === undefined)(
  "pre-affinity pending messages stay on legacy even before they have a session",
  async () => {
    const f = fixture();
    const payload = delivery(address());
    const key = `pending:${payload.continuationKey}`;
    cleanup.push(key);
    await redis.eval(
      "return redis.call('RPUSH', KEYS[1], ARGV[1])",
      [key],
      [JSON.stringify(payload)],
    );
    expect(Result.isOk(await f.client().sendMessage(payload))).toBe(true);
    expect(f.legacy.calls.map(({ route }) => route)).toEqual([WIRE_ROUTES.message]);
    expect(f.current.calls).toHaveLength(0);
  },
);

test.skipIf(url === undefined)(
  "claimed legacy work with a missing ownership hook fails closed",
  async () => {
    const f = fixture();
    const payload = delivery(address());
    const key = payload.continuationKey;
    cleanup.push(`agent:active:${key}`, `pending:${key}`, `agent:seen:${key}`);
    await store.delivery.enqueue(payload);
    const claimed = await store.delivery.claim(key);
    if (Result.isError(claimed) || claimed.value === undefined)
      throw new Error("fixture did not claim");
    const original = claimed.value.payload;
    cleanup.push(`agent:render-target:${original.dispatchId}`);
    await store.delivery.markLive(key, original.dispatchId, original.messageId);
    await store.delivery.confirmSession(
      key,
      original.dispatchId,
      original.messageId,
      "lost-legacy-session",
    );
    expect(Result.isError(await f.client().sendMessage(payload))).toBe(true);
    expect(f.legacy.calls).toHaveLength(0);
    expect(f.current.calls).toHaveLength(0);
    const binding = await store.executions.read(key);
    expect(Result.isOk(binding) && binding.value).toBeUndefined();
    await redis.srem("agent:queues", `k:${key}`);
  },
);

test.skipIf(url === undefined)(
  "corrupt legacy delivery is never classified as an unused continuation",
  async () => {
    const f = fixture();
    const payload = delivery(address());
    const key = payload.continuationKey;
    cleanup.push(`agent:active:${key}`);
    for (const raw of ["invalid JSON", '{"sessionId":"unreadable-legacy-session"}']) {
      await redis.set(`agent:active:${key}`, raw);
      expect(await store.deliveries.read(key)).toBeUndefined();
      expect(Result.isError(await store.deliveries.readStrict(key))).toBe(true);
      expect(Result.isError(await f.client().prepareContinuation(payload))).toBe(true);
      expect(Result.isError(await f.client().sendMessage(payload))).toBe(true);
      const binding = await store.executions.read(key);
      expect(Result.isOk(binding) && binding.value).toBeUndefined();
    }
    expect(f.legacy.calls).toHaveLength(0);
    expect(f.current.calls).toHaveLength(0);
    expect(f.legacy.sessions.size).toBe(0);
    expect(f.current.sessions.size).toBe(0);
  },
);

test.skipIf(url === undefined)(
  "an alias pointing at a different deployment cannot impersonate the configured target",
  async () => {
    const f = fixture();
    const payload = delivery(address());
    const config = {
      ...f.config,
      legacy: "expected-legacy",
      targets: f.config.targets.map((target) =>
        target.identity.id === f.config.legacy
          ? { ...target, identity: { ...target.identity, id: "expected-legacy" } }
          : target,
      ),
    };
    expect(Result.isError(await f.client(config).sendMessage(payload))).toBe(true);
    expect(f.legacy.calls).toHaveLength(0);
    expect(f.current.calls).toHaveLength(0);
  },
);

test.skipIf(url === undefined)(
  "real submitMessage pins new work before enqueue and preserves pre-upgrade queued work",
  async () => {
    const f = fixture();
    const reporter = { emit: () => undefined, captureDefect: () => undefined };
    for (const queuedBeforeUpgrade of [false, true]) {
      const payload = delivery(address());
      const key = payload.continuationKey;
      cleanup.push(`agent:active:${key}`, `pending:${key}`, `agent:seen:${key}`);
      if (queuedBeforeUpgrade)
        await store.delivery.enqueue({ ...payload, messageId: "100000000000000009" });
      const accepted = await submitMessage(
        { deps: { eve: f.client(), store, reporter }, isStopped: () => false },
        payload,
      );
      expect(Result.isOk(accepted)).toBe(true);
      const binding = await store.executions.read(key);
      if (Result.isError(binding)) throw binding.error;
      expect(binding.value?.identity.id).toBe(
        queuedBeforeUpgrade ? f.config.legacy : f.config.current,
      );
      const held = await store.deliveries.read(key);
      if (held === undefined) throw new Error("actual queue did not claim its delivery");
      expect(held.phase).toBe("live");
      cleanup.push(
        `agent:render-target:${held.dispatchId}`,
        `agent:dispatch-execution:${held.dispatchId}`,
      );
      await redis.srem("agent:queues", `k:${key}`);
    }
    expect(f.current.calls.filter(({ route }) => route === WIRE_ROUTES.message)).toHaveLength(1);
    expect(f.legacy.calls.filter(({ route }) => route === WIRE_ROUTES.message)).toHaveLength(1);
  },
);

test.skipIf(url === undefined)(
  "operator capability cannot enable Stop on current, legacy, or unknown runtimes",
  async () => {
    for (const runtime of ["eve-0.81.1", "eve-0.31.3", "eve-9.99.0"]) {
      const f = fixture(runtime);
      const payload = delivery(address());
      expect(Result.isOk(await f.client().sendMessage(payload))).toBe(true);
      const command = await stopPayload(payload);
      const client = f.client(offerCancellation(f.config));
      const requests = [...f.current.requests];
      expect(await client.supportsCancel(payload)).toBe(false);
      const refused = await client.sendCancel(command);
      expect(Result.isOk(refused) && refused.value.status).toBe("unsupported");
      expect(f.current.requests).toEqual(requests);
      expect(f.legacy.calls).toHaveLength(0);
    }
  },
);

test.skipIf(url === undefined)(
  "future verified Stop transport keeps target, generation and request identity across rollback and lost response",
  async () => {
    const f = fixture("eve-9.99.0");
    const payload = delivery(address());
    await f.client().sendMessage(payload);
    const command = await stopPayload(payload);
    const router = verifiedTestRouter({
      ...offerCancellation(f.config),
      current: f.config.legacy,
    });
    expect(await router.supportsCancel(payload)).toBe(true);
    f.current.loseCancelResponses(1);
    const result = await router.sendCancel(command);
    expect(Result.isOk(result) && result.value.status).toBe("accepted");
    const attempts = f.current.calls.filter(({ route }) => route === WIRE_ROUTES.cancel);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    expect(attempts[0]?.body).toBe(JSON.stringify(command));
    const binding = await store.executions.read(command.continuationKey);
    if (Result.isError(binding)) throw binding.error;
    expect(attempts[0]?.generation).toBe(binding.value?.generation);
    expect(f.legacy.calls).toHaveLength(0);
  },
);

test.skipIf(url === undefined)(
  "Stop refuses missing bindings, wrong sessions and absent capabilities without establishing any route",
  async () => {
    const f = fixture("eve-9.99.0");
    const payload = delivery(address());
    await f.client().sendMessage(payload);
    const command = await stopPayload(payload);
    const unsupported = verifiedTestRouter(f.config);
    expect(await unsupported.supportsCancel(payload)).toBe(false);
    const refused = await unsupported.sendCancel(command);
    expect(Result.isOk(refused) && refused.value.status).toBe("unsupported");
    const router = verifiedTestRouter(offerCancellation(f.config));
    const stale = await router.sendCancel({ ...command, sessionId: "different-session" });
    expect(Result.isOk(stale) && stale.value.status).toBe("stale");
    expect(await router.supportsCancel({ continuationKey: payload.continuationKey })).toBe(false);
    await redis.del(`agent:dispatch-execution:${payload.dispatchId}`);
    expect(Result.isError(await router.sendCancel(command))).toBe(true);
    const missing = await store.executions.dispatch(payload.dispatchId);
    expect(Result.isOk(missing) && missing.value).toBeUndefined();
    await redis.del(`agent:execution:${payload.continuationKey}`);
    const before = [...f.current.requests];
    expect(await router.supportsCancel(payload)).toBe(false);
    expect(Result.isError(await router.sendCancel(command))).toBe(true);
    const binding = await store.executions.read(payload.continuationKey);
    expect(Result.isOk(binding) && binding.value).toBeUndefined();
    expect(f.current.requests).toEqual(before);
    expect(f.current.calls.map(({ route }) => route)).toEqual([WIRE_ROUTES.message]);
    expect(f.legacy.calls).toHaveLength(0);
  },
);

test.skipIf(url === undefined)(
  "changed generation, session, deployment identity or immutable origin refuses Stop before HTTP",
  async () => {
    const f = fixture("eve-9.99.0");
    const payload = delivery(address());
    await f.client().sendMessage(payload);
    const command = await stopPayload(payload);
    const original = await store.executions.dispatch(payload.dispatchId);
    if (Result.isError(original) || original.value === undefined) throw new Error("No binding");
    const binding = original.value;
    const config = offerCancellation(f.config);
    const router = verifiedTestRouter(config);
    for (const altered of [
      { ...binding, generation: crypto.randomUUID() },
      { ...binding, sessionId: "later-session" },
      { ...binding, identity: { ...binding.identity, id: "different-deployment" } },
      "corrupt binding",
    ]) {
      await redis.set(`agent:dispatch-execution:${payload.dispatchId}`, altered);
      expect(await router.supportsCancel(payload)).toBe(false);
      expect(Result.isError(await router.sendCancel(command))).toBe(true);
    }
    await redis.set(`agent:dispatch-execution:${payload.dispatchId}`, binding);
    for (const targetChange of [{ enabled: false }, { origin: f.legacy.origin }]) {
      const changed = verifiedTestRouter({
        ...config,
        targets: config.targets.map((target) =>
          target.identity.id === f.current.identity.id ? { ...target, ...targetChange } : target,
        ),
      });
      expect(await changed.supportsCancel(payload)).toBe(false);
      expect(Result.isError(await changed.sendCancel(command))).toBe(true);
    }
    expect(f.current.calls.map(({ route }) => route)).toEqual([WIRE_ROUTES.message]);
    expect(f.legacy.calls).toHaveLength(0);
  },
);

test.skipIf(url === undefined)(
  "reset racing route resolution is rejected by the agent generation guard without retry",
  async () => {
    const f = fixture("eve-9.99.0");
    const payload = delivery(address());
    await f.client().sendMessage(payload);
    const command = await stopPayload(payload);
    const resolveRoute = createRouteResolver({
      store,
      config: offerCancellation(f.config),
      secret,
    });
    const router = createRoutedCancellation({
      resolve: async (target) => {
        const selected = await resolveRoute(target, false);
        const resetId = crypto.randomUUID();
        await redis.set(`agent:reset:${target.continuationKey}`, resetId, { ex: 60 });
        expect(
          await store.execution.retireSession(
            target.continuationKey,
            resetId,
            selected.binding.generation,
          ),
        ).toBe(true);
        return Result.ok(selected);
      },
      isRuntimeVerified: (runtime) => runtime === "eve-9.99.0",
    });
    const refused = await router.sendCancel(command);
    expect(Result.isError(refused) && "status" in refused.error && refused.error.status).toBe(409);
    expect(f.current.requests.filter((path) => path === WIRE_ROUTES.cancel)).toHaveLength(1);
    expect(f.current.calls.map(({ route }) => route)).toEqual([WIRE_ROUTES.message]);
    expect(f.legacy.calls).toHaveLength(0);
  },
);
