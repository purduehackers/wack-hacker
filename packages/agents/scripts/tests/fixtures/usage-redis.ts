import "./catalog-environment.ts";
import { strict as assert } from "node:assert";

import { closeRedis, getRedis } from "@repo/shared/redis";

import { env } from "../../../agent/env.ts";
import { recordUsageTelemetry } from "../../../agent/lib/policy/usage-telemetry.ts";
import { turnTokenKey } from "../../../agent/lib/telemetry.ts";
import { usageContext, usageEvent } from "./usage-context.ts";

const context = usageContext(crypto.randomUUID());
const parent = context.session.parent;
if (parent === undefined) throw new Error("Missing test parent");
const redis = getRedis({ url: env.REDIS_URL });
const totals = [
  turnTokenKey(context.session.id, "child-turn"),
  turnTokenKey(parent.sessionId, "parent-turn"),
];
try {
  await Promise.all(Array.from({ length: 8 }, () => recordUsageTelemetry(usageEvent(), context)));
  for (const key of totals) {
    assert.equal(await redis.get(key), 18);
    assert.ok((await redis.pttl(key)) > 0);
    assert.ok((await redis.pttl(`${key}:events`)) > 0);
  }
  await recordUsageTelemetry(usageEvent("another-call"), context);
  for (const key of totals) assert.equal(await redis.get(key), 36);
  process.stdout.write("usage Redis replay passed\n");
} finally {
  await redis.del(...totals.flatMap((key) => [key, `${key}:events`]));
  await closeRedis();
}
