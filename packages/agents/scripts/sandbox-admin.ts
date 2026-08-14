#!/usr/bin/env bun

/**
 * @fileoverview Operator CLI for the Discord bot's Vercel Sandbox fleet.
 * It lists managed sandboxes, deletes superseded generations, and can stop
 * the active sandbox after an explicit two-flag confirmation. Every mutation
 * re-checks the supervisor mutex and the active generation record first.
 * A concurrent supervisor run therefore aborts the operation instead of
 * deleting a live sandbox.
 *
 * Exit codes: 0 on success, 1 on a reported failure, 2 on bad usage.
 */

import {
  BOT_ACTIVE_GENERATION_KEY,
  BOT_SUPERVISOR_MUTEX_KEY,
  readActiveBotGeneration,
  type ActiveBotGeneration,
} from "@repo/shared/bot/generation";
import { InvalidInput, messageOf, NotFound, serializeError, Transient } from "@repo/shared/errors";
import { getRedis, type RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import { Sandbox } from "@vercel/sandbox";

const MANAGED_TAGS = { managedBy: "wack-hacker", workload: "discord-bot" } as const;

type SandboxAdminError = InvalidInput | NotFound | Transient;

function usage(): never {
  console.error(`usage, from packages/agents:
  bun run sandbox list
  bun run sandbox cleanup [--apply]
  bun run sandbox stop-active --confirm <exact-name> --apply`);
  process.exit(2);
}

function requiredEnvironment(name: string): Result<string, InvalidInput> {
  const value = process.env[name];
  return value
    ? Result.ok(value)
    : Result.err(new InvalidInput({ subject: "environment", issues: [`${name} is required`] }));
}

function auth(): Result<{ token: string; teamId: string; projectId: string }, InvalidInput> {
  return Result.gen(function* () {
    return Result.ok({
      token: yield* requiredEnvironment("VERCEL_TOKEN"),
      teamId: yield* requiredEnvironment("VERCEL_TEAM_ID"),
      projectId: yield* requiredEnvironment("VERCEL_PROJECT_ID"),
    });
  });
}

function coordination(): Promise<
  Result<{ redis: RedisClient; active: ActiveBotGeneration | undefined }, SandboxAdminError>
> {
  return Result.gen(async function* () {
    const url = yield* requiredEnvironment("UPSTASH_REDIS_REST_URL");
    const token = yield* requiredEnvironment("UPSTASH_REDIS_REST_TOKEN");
    const redis = getRedis({ url, token });
    const active = yield* Result.await(
      Result.tryPromise({
        try: () => readActiveBotGeneration(redis),
        catch: (cause) =>
          new Transient({ operation: "read active bot generation", detail: messageOf(cause) }),
      }),
    );
    return Result.ok({ redis, active });
  });
}

function assertStable(
  redis: RedisClient,
  expected: ActiveBotGeneration,
): Promise<Result<void, Transient>> {
  return Result.gen(async function* () {
    const [mutex, active] = yield* Result.await(
      Result.tryPromise({
        try: () =>
          Promise.all([redis.get(BOT_SUPERVISOR_MUTEX_KEY), readActiveBotGeneration(redis)]),
        catch: (cause) =>
          new Transient({
            operation: "re-check supervisor coordination",
            detail: messageOf(cause),
          }),
      }),
    );
    if (mutex !== undefined && mutex !== null) {
      return Result.err(
        new Transient({
          operation: "sandbox mutation",
          detail: "a supervisor invocation owns the mutex; retry after it exits",
        }),
      );
    }
    if (
      active === undefined ||
      active.generation !== expected.generation ||
      active.sandboxName !== expected.sandboxName
    ) {
      return Result.err(
        new Transient({
          operation: "sandbox mutation",
          detail: "active generation changed during the operation; nothing was deleted",
        }),
      );
    }
    return Result.ok(undefined);
  });
}

function managedSandboxes(): Promise<
  Result<Awaited<ReturnType<typeof collectManaged>>, SandboxAdminError>
> {
  return Result.gen(async function* () {
    const credentials = yield* auth();
    const entries = yield* Result.await(
      Result.tryPromise({
        try: () => collectManaged(credentials),
        catch: (cause) =>
          new Transient({ operation: "list managed sandboxes", detail: messageOf(cause) }),
      }),
    );
    return Result.ok(entries);
  });
}

async function collectManaged(credentials: { token: string; teamId: string; projectId: string }) {
  // One tag filter only. The API rejects more ("Only one tag filter is supported at a time").
  // The loop below matches the rest of the managed set.
  const paginator = await Sandbox.list({
    tags: { managedBy: MANAGED_TAGS.managedBy },
    ...credentials,
  });
  const entries = [];
  for await (const entry of paginator) {
    // Narrow to the full managed set the API could not filter on, so this never
    // reports — or offers to delete — a sandbox this project does not own.
    const managed = Object.entries(MANAGED_TAGS).every(
      ([key, value]) => entry.tags?.[key] === value,
    );
    if (managed) entries.push(entry);
  }
  return entries;
}

function remove(name: string): Promise<Result<void, SandboxAdminError>> {
  return Result.gen(async function* () {
    const credentials = yield* auth();
    yield* Result.await(
      Result.tryPromise({
        try: async () => {
          const sandbox = await Sandbox.get({ name, resume: false, ...credentials });
          if (sandbox.status === "running") await sandbox.stop();
          await sandbox.delete();
        },
        catch: (cause) =>
          new Transient({ operation: `delete sandbox ${name}`, detail: messageOf(cause) }),
      }),
    );
    return Result.ok(undefined);
  });
}

function list(): Promise<Result<void, SandboxAdminError>> {
  return Result.gen(async function* () {
    const { active } = yield* Result.await(coordination());
    const entries = yield* Result.await(managedSandboxes());
    console.info(
      JSON.stringify(
        {
          active,
          sandboxes: entries.map((entry) => ({
            name: entry.name,
            status: entry.status,
            generation: entry.tags?.["generation"],
            active: entry.name === active?.sandboxName,
          })),
        },
        undefined,
        2,
      ),
    );
    return Result.ok(undefined);
  });
}

function cleanup(apply: boolean): Promise<Result<void, SandboxAdminError>> {
  return Result.gen(async function* () {
    const { redis, active } = yield* Result.await(coordination());
    if (active === undefined) {
      // Refuse to guess which managed sandbox is safe to delete.
      return Result.err(
        new NotFound({ kind: "active bot generation", id: BOT_ACTIVE_GENERATION_KEY }),
      );
    }
    const entries = yield* Result.await(managedSandboxes());
    const candidates = entries.filter((entry) => {
      if (entry.name === active.sandboxName) return false;
      const generationText = entry.tags?.["generation"];
      if (generationText === undefined || !/^[1-9]\d*$/u.test(generationText)) return false;
      const generation = Number(generationText);
      return Number.isSafeInteger(generation) && generation <= active.generation;
    });
    console.info(
      JSON.stringify({
        apply,
        active,
        candidates: candidates.map(({ name, status, tags }) => ({
          name,
          status,
          generation: tags?.["generation"],
        })),
      }),
    );
    if (!apply) return Result.ok(undefined);
    for (const orphan of candidates) {
      yield* Result.await(assertStable(redis, active));
      yield* Result.await(remove(orphan.name));
      console.info(JSON.stringify({ deleted: orphan.name }));
    }
    return Result.ok(undefined);
  });
}

function stopActive(confirm: string, apply: boolean): Promise<Result<void, SandboxAdminError>> {
  return Result.gen(async function* () {
    const { redis, active } = yield* Result.await(coordination());
    if (active === undefined) {
      return Result.err(
        new NotFound({ kind: "active sandbox record", id: BOT_ACTIVE_GENERATION_KEY }),
      );
    }
    if (!apply || confirm !== active.sandboxName) {
      return Result.err(
        new InvalidInput({
          subject: "stop-active confirmation",
          issues: [
            `refusing active stop; pass --confirm ${active.sandboxName} --apply after disabling supervision`,
          ],
        }),
      );
    }
    yield* Result.await(assertStable(redis, active));
    yield* Result.await(remove(active.sandboxName));
    console.info(
      JSON.stringify({
        stopped: active.sandboxName,
        generation: active.generation,
        activeRecordPreserved: true,
      }),
    );
    return Result.ok(undefined);
  });
}

function main(): Promise<Result<void, SandboxAdminError>> {
  const arguments_ = process.argv.slice(2);
  const action = arguments_[0];
  const apply = arguments_.includes("--apply");
  const confirmIndex = arguments_.indexOf("--confirm");
  const confirm = confirmIndex === -1 ? undefined : arguments_[confirmIndex + 1];
  if (action === "list" && arguments_.length === 1) return list();
  if (action === "cleanup" && arguments_.every((value) => ["cleanup", "--apply"].includes(value))) {
    return cleanup(apply);
  }
  if (action === "stop-active") {
    if (arguments_.length !== 4 || confirmIndex === -1 || confirm === undefined || !apply) usage();
    return stopActive(confirm, apply);
  }
  usage();
}

(await main()).match({
  ok: () => {},
  err: (error) => {
    console.error(JSON.stringify(serializeError(error)));
    process.exit(1);
  },
});
