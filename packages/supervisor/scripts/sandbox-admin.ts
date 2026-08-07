#!/usr/bin/env bun

import { Sandbox } from "@vercel/sandbox";

import {
  BOT_SUPERVISOR_MUTEX_KEY,
  readActiveBotGeneration,
  type ActiveBotGeneration,
} from "../../shared/src/bot-generation.ts";
import { getRedis, type RedisClient } from "../../shared/src/redis/client.ts";
const MANAGED_TAGS = { managedBy: "wack-hacker", workload: "discord-bot" } as const;

function usage(): never {
  console.error(`usage:
  bun packages/supervisor/scripts/sandbox-admin.ts list
  bun packages/supervisor/scripts/sandbox-admin.ts cleanup [--apply]
  bun packages/supervisor/scripts/sandbox-admin.ts stop-active --confirm <exact-name> --apply`);
  process.exit(2);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function auth() {
  return {
    token: requiredEnvironment("VERCEL_TOKEN"),
    teamId: requiredEnvironment("VERCEL_TEAM_ID"),
    projectId: requiredEnvironment("VERCEL_PROJECT_ID"),
  };
}

async function coordination(): Promise<{
  redis: RedisClient;
  active: ActiveBotGeneration | undefined;
}> {
  const redis = getRedis({
    url: requiredEnvironment("UPSTASH_REDIS_REST_URL"),
    token: requiredEnvironment("UPSTASH_REDIS_REST_TOKEN"),
  });
  return { redis, active: await readActiveBotGeneration(redis) };
}

async function assertStable(redis: RedisClient, expected: ActiveBotGeneration): Promise<void> {
  const [mutex, active] = await Promise.all([
    redis.get(BOT_SUPERVISOR_MUTEX_KEY),
    readActiveBotGeneration(redis),
  ]);
  if (mutex !== undefined && mutex !== null)
    throw new Error("a supervisor invocation owns the mutex; retry after it exits");
  if (
    active === undefined ||
    active.generation !== expected.generation ||
    active.sandboxName !== expected.sandboxName
  ) {
    throw new Error("active generation changed during the operation; nothing was deleted");
  }
}

async function managedSandboxes() {
  const paginator = await Sandbox.list({ tags: { ...MANAGED_TAGS }, ...auth() });
  const entries = [];
  for await (const entry of paginator) entries.push(entry);
  return entries;
}

async function remove(name: string): Promise<void> {
  const sandbox = await Sandbox.get({ name, resume: false, ...auth() });
  if (sandbox.status === "running") await sandbox.stop();
  await sandbox.delete();
}

async function list(): Promise<void> {
  const [{ active }, entries] = await Promise.all([coordination(), managedSandboxes()]);
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
}

async function cleanup(apply: boolean): Promise<void> {
  const { redis, active } = await coordination();
  if (active === undefined) {
    throw new Error(
      "no active generation; refusing to guess which managed sandbox is safe to delete",
    );
  }
  const entries = await managedSandboxes();
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
  if (!apply) return;
  for (const orphan of candidates) {
    await assertStable(redis, active);
    await remove(orphan.name);
    console.info(JSON.stringify({ deleted: orphan.name }));
  }
}

async function stopActive(confirm: string | undefined, apply: boolean): Promise<void> {
  const { redis, active } = await coordination();
  if (active === undefined) throw new Error("there is no active sandbox record");
  if (!apply || confirm !== active.sandboxName) {
    throw new Error(
      `refusing active stop; pass --confirm ${active.sandboxName} --apply after disabling supervision`,
    );
  }
  await assertStable(redis, active);
  await remove(active.sandboxName);
  console.info(
    JSON.stringify({
      stopped: active.sandboxName,
      generation: active.generation,
      activeRecordPreserved: true,
    }),
  );
}

const arguments_ = process.argv.slice(2);
const action = arguments_[0];
const apply = arguments_.includes("--apply");
const confirmIndex = arguments_.indexOf("--confirm");
const confirm = confirmIndex === -1 ? undefined : arguments_[confirmIndex + 1];
if (action === "list" && arguments_.length === 1) await list();
else if (
  action === "cleanup" &&
  arguments_.every((value) => ["cleanup", "--apply"].includes(value))
) {
  await cleanup(apply);
} else if (action === "stop-active") {
  if (arguments_.length !== 4 || confirmIndex === -1 || confirm === undefined || !apply) usage();
  await stopActive(confirm, apply);
} else usage();
