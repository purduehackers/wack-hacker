import { afterAll, beforeAll, expect, test } from "bun:test";

import {
  createConversationStore,
  EXECUTION_GENERATION_HEADER,
  EXECUTION_PROBE_ROUTE,
  type ConversationStore,
  type ExecutionIdentity,
} from "@repo/shared/conversations";
import { closeRedis, getRedis, type RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import {
  WIRE_ROUTES,
  decodeDeliveryPayload,
  decodeInteractionPayload,
  decodeResetRequestPayload,
  decodeSteerRequestPayload,
  type DeliveryPayload,
} from "@repo/shared/wire";

import { createExecutionBridge } from "../../../agents/agent/lib/discord/execution-bridge.ts";
import { submitMessage } from "../utils/conversation/queue.ts";
import { createExecutionStreamClient } from "./execution-stream.ts";
import { parseExecutionTargets, type ExecutionTargets } from "./execution-targets.ts";
import { createRoutedAgentClient } from "./routed-client.ts";

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

function deployment(identity: ExecutionIdentity) {
  const sessions = new Map<string, string>();
  const calls: { route: string; key: string; generation: string | undefined }[] = [];
  let probeStatus = 200;
  const bridge = createExecutionBridge({ store, identity: () => identity });
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const streamPath = new URL(request.url).pathname;
      if (request.method === "GET" && streamPath.endsWith("/stream")) {
        calls.push({ route: streamPath, key: "stream", generation: undefined });
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
      if (request.headers.get("authorization") !== `Bearer ${secret}`)
        return new Response("unauthorized", { status: 401 });
      const route = new URL(request.url).pathname;
      if (route === EXECUTION_PROBE_ROUTE) {
        if (probeStatus !== 200) return new Response("lookup unavailable", { status: probeStatus });
        return bridge.probe(request, async (key) => {
          const id = sessions.get(key);
          return id === undefined ? undefined : { id };
        });
      }
      const body: unknown = await request.json();
      const decoded =
        route === WIRE_ROUTES.message
          ? decodeDeliveryPayload(body)
          : route === WIRE_ROUTES.interaction
            ? decodeInteractionPayload(body)
            : route === WIRE_ROUTES.reset
              ? decodeResetRequestPayload(body)
              : decodeSteerRequestPayload(body);
      if (Result.isError(decoded)) return new Response("invalid", { status: 400 });
      const key = decoded.value.continuationKey;
      const guarded = await bridge.guard(request, key);
      if (guarded instanceof Response) return guarded;
      calls.push({
        route,
        key,
        generation: request.headers.get(EXECUTION_GENERATION_HEADER) ?? undefined,
      });
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
    origin: server.url.origin,
    identity,
    setProbeStatus: (status: number) => {
      probeStatus = status;
    },
  };
}

function fixture() {
  const legacy = deployment({
    id: "retained-legacy",
    projectId: "legacy-project",
    runtime: "eve-0.31.3",
    sandbox: "vercel-sandbox-v1",
  });
  const current = deployment({
    id: "candidate",
    projectId: "candidate-project",
    runtime: "eve-0.81.1",
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
