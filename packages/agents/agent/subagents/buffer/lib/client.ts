import { createHash, randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

import { bufferOperations, getDb } from "@repo/shared/db";
import { UpstreamError } from "@repo/shared/errors";
import { getRedis } from "@repo/shared/redis";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { env, tursoConfig } from "../../../env.ts";
import { redactProviderText } from "../../../lib/policy/provider-redaction.ts";
import { executeOnce } from "./replay.ts";
import { assertOrganizationScope, bufferResultSchema, mutationErrors } from "./results.ts";
import type { BufferResult } from "./results.ts";
import { operationDocument } from "./schema.ts";
export { bufferResultSchema, mutationErrors } from "./results.ts";
export type { BufferResult } from "./results.ts";

const responseSchema = z.object({
  data: z.record(z.string(), z.json()).nullish(),
  errors: z.array(z.object({ message: z.string(), extensions: z.json().optional() })).optional(),
});
const scopeSchema = z.object({
  account: z.object({ organizations: z.array(z.object({ id: z.string() })) }),
});
const MAX_RESPONSE_BYTES = 8_000_000;

export function allowedOrganizations(): string[] {
  const ids =
    env.BUFFER_ORGANIZATION_IDS?.split(",")
      .map((id) => id.trim())
      .filter(Boolean) ?? [];
  if (ids.length === 0) throw new Error("BUFFER_ORGANIZATION_IDS is not configured");
  return ids;
}

function quotaStore() {
  return getRedis({ url: env.REDIS_URL });
}

/** Serialize requests across instances; every window is shared by the API key. */
async function reserveRequest(signal: AbortSignal) {
  const redis = quotaStore();
  const key = `buffer:rate:${createHash("sha256")
    .update(env.BUFFER_API_KEY ?? "")
    .digest("hex")
    .slice(0, 16)}`;
  const token = randomUUID();
  const deadline = Date.now() + 25_000;
  while ((await redis.set(`${key}:lock`, token, { nx: true, px: 30_000 })) !== "OK") {
    if (Date.now() >= deadline)
      throw new Error("Buffer is busy; retry after the current request completes");
    await setTimeout(250, undefined, { signal });
  }
  const release = async () => {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      [`${key}:lock`],
      [token],
    );
  };
  const blocked = await redis.get(`${key}:blocked`);
  if (blocked !== undefined && blocked !== null) {
    await release();
    throw new Error(
      "Buffer quota is exhausted; wait for the provider's rate-limit window to reset",
    );
  }
  return { redis, key, release };
}

async function request(
  query: string,
  variables: Readonly<Record<string, z.output<ReturnType<typeof z.json>>>>,
  signal: AbortSignal,
) {
  if (env.BUFFER_API_KEY === undefined) throw new Error("BUFFER_API_KEY is not configured");
  const body = JSON.stringify({ query, variables });
  if (body.length > 500_000) throw new Error("Buffer request exceeds 500 KB");
  const { redis, key, release } = await reserveRequest(signal);
  try {
    const response = await fetch("https://api.buffer.com", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.BUFFER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body,
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });
    const rateLimit = response.headers.get("ratelimit") ?? undefined;
    const exhausted = [...(rateLimit ?? "").matchAll(/r\s*=\s*0\s*;\s*t\s*=\s*(\d+)/gu)].map(
      (match) => Number(match[1]),
    );
    const retry = Number(response.headers.get("retry-after"));
    const wait = Math.max(0, ...exhausted, response.status === 429 ? retry || 60 : 0);
    if (wait > 0) await redis.set(`${key}:blocked`, "1", { ex: Math.ceil(wait) });
    if (!response.ok)
      throw new UpstreamError({
        service: "Buffer",
        status: response.status,
        detail: "Buffer HTTP request failed",
      });
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("Buffer returned no body");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Buffer response exceeds 8 MB; narrow the selection or page size");
      }
      chunks.push(part.value);
    }
    const text = await new Blob(chunks).text();
    const parsed = responseSchema.parse(JSON.parse(text));
    return { ...parsed, ...(rateLimit === undefined ? {} : { rateLimit }) };
  } finally {
    await release();
  }
}

/** The key may belong only to configured orgs, including for ID-only operations. */
async function assertAccountScope(signal: AbortSignal): Promise<void> {
  const result = await request("query { account { organizations { id } } }", {}, signal);
  const organizations = scopeSchema.parse(result.data).account.organizations;
  assertOrganizationScope(
    organizations.map((membership) => membership.id),
    allowedOrganizations(),
  );
}

async function executeRequest(
  name: string,
  variables: Readonly<Record<string, z.output<ReturnType<typeof z.json>>>>,
  selection: string | undefined,
  signal: AbortSignal,
): Promise<BufferResult> {
  const { document } = operationDocument(name, variables, selection);
  const response = await request(document, variables, signal);
  const data = response.data?.[name];
  const errors = [
    ...(response.errors ?? []).map((issue) => redactProviderText(issue.message)),
    ...(data === undefined ? ["Buffer returned no operation result"] : mutationErrors(data)),
  ];
  return bufferResultSchema.parse({
    ok: errors.length === 0,
    operation: name,
    // oxlint-disable-next-line unicorn/no-null -- GraphQL represents an unavailable operation result as null
    data: data ?? null,
    errors,
    ...(response.rateLimit === undefined ? {} : { rateLimit: response.rateLimit }),
  });
}

/** Check the account boundary for every call, including mutations with ID-only inputs. */
export async function executeBuffer(
  name: string,
  variables: Readonly<Record<string, z.output<ReturnType<typeof z.json>>>>,
  selection: string | undefined,
  callKey: string,
  signal: AbortSignal,
): Promise<BufferResult> {
  const { kind, document } = operationDocument(name, variables, selection);
  await assertAccountScope(signal);
  if (kind === "query") return executeRequest(name, variables, selection, signal);
  const db = getDb(tursoConfig());
  const inputHash = createHash("sha256")
    .update(JSON.stringify([document, variables]))
    .digest("hex");
  return executeOnce(
    inputHash,
    {
      start: async () =>
        (
          await db
            .insert(bufferOperations)
            .values({
              id: callKey,
              operation: name,
              inputHash,
              status: "started",
              createdAt: new Date().toISOString(),
            })
            .onConflictDoNothing()
            .returning()
        ).length > 0,
      previous: async () =>
        (await db.select().from(bufferOperations).where(eq(bufferOperations.id, callKey)))[0],
      finish: async (result) => {
        await db
          .update(bufferOperations)
          .set({ status: "completed", result: JSON.stringify(result) })
          .where(eq(bufferOperations.id, callKey));
      },
    },
    () => executeRequest(name, variables, selection, signal),
  );
}
