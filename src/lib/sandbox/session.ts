import { Redis } from "@upstash/redis";
import { log } from "evlog";

import type { RedisLike } from "@/bot/types";

import type { GetOrCreateSessionParams, SandboxSession, SandboxSessionMetadata } from "./types.ts";

import { createCodingSandbox } from "./factory.ts";
import { VercelSandbox } from "./vercel-sandbox.ts";

export type { GetOrCreateSessionParams, SandboxSession, SandboxSessionMetadata } from "./types.ts";

const KEY_PREFIX = "sandbox:session:";
const TTL_SECONDS = 35 * 60;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function redisKey(threadKey: string): string {
  return `${KEY_PREFIX}${threadKey}`;
}

function getRedis(redis?: RedisLike): RedisLike {
  return redis ?? (Redis.fromEnv() as unknown as RedisLike);
}

function generateBranchName(repo: string): string {
  const [, name] = repo.split("/");
  const slug = (name ?? "repo").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `phoenix-agent/${slug}-${suffix}`;
}

/**
 * Fetch the session for this Discord thread, reconnecting to the existing
 * sandbox if one is cached. Provisions a fresh sandbox — clone, branch, git
 * identity, toolchain — when no session exists or the cached one has
 * expired.
 *
 * `extendTimeout` is called on every access so active threads keep the
 * sandbox alive past its natural deadline. Returns a `SandboxSession` with
 * `fresh: true` when a new sandbox was created (the caller can log/meter it).
 */
export async function getOrCreateSession(
  params: GetOrCreateSessionParams,
): Promise<SandboxSession> {
  const redis = getRedis(params.redis);
  const key = redisKey(params.threadKey);

  const cached = await redis.get<SandboxSessionMetadata>(key);

  if (cached && cached.repo === params.repo && cached.expiresAt > Date.now() + 60_000) {
    try {
      const sandbox = await VercelSandbox.reconnect(cached.sandboxId, {
        githubToken: params.githubToken,
        expiresAt: cached.expiresAt,
      });
      const bump = await sandbox.extendTimeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const metadata: SandboxSessionMetadata = { ...cached, expiresAt: bump.expiresAt };
      await redis.set(key, metadata, { ex: TTL_SECONDS });
      log.info("sandbox", `Reused sandbox ${cached.sandboxId} for thread ${params.threadKey}`);
      return { sandbox, metadata, fresh: false };
    } catch (err) {
      log.warn(
        "sandbox",
        `Reconnect failed for sandbox ${cached.sandboxId}: ${String(err)}. Provisioning fresh.`,
      );
      // Fall through to fresh provisioning below.
      await redis.del(key);
    }
  } else if (cached && cached.repo !== params.repo) {
    log.warn(
      "sandbox",
      `Repo changed for thread ${params.threadKey} (${cached.repo} → ${params.repo}); discarding old sandbox`,
    );
    try {
      const old = await VercelSandbox.reconnect(cached.sandboxId, {
        githubToken: params.githubToken,
      });
      await old.stop();
    } catch (err) {
      log.warn("sandbox", `Failed to stop stale sandbox ${cached.sandboxId}: ${String(err)}`);
    }
    await redis.del(key);
  }

  const branch = params.branch ?? generateBranchName(params.repo);
  const sandbox = await createCodingSandbox({
    repo: params.repo,
    githubToken: params.githubToken,
    branch,
    baseBranch: params.baseBranch,
    gitUser: params.gitUser,
    baseSnapshotId: params.baseSnapshotId,
    timeoutMs: params.timeoutMs,
  });

  const metadata: SandboxSessionMetadata = {
    sandboxId: sandbox.name,
    repo: params.repo,
    branch,
    repoDir: sandbox.workingDirectory,
    expiresAt: Date.now() + (params.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  };

  await redis.set(key, metadata, { ex: TTL_SECONDS });
  log.info("sandbox", `Provisioned sandbox ${sandbox.name} for thread ${params.threadKey}`);
  return { sandbox, metadata, fresh: true };
}

/**
 * Release the sandbox for this thread (if any). Safe to call when no session
 * exists. Errors are logged but never thrown — conversation cleanup must not
 * fail because a sandbox release hiccupped.
 */
export async function releaseSession(
  threadKey: string,
  options: { redis?: RedisLike; githubToken?: string } = {},
): Promise<void> {
  const redis = getRedis(options.redis);
  const key = redisKey(threadKey);
  const metadata = await redis.get<SandboxSessionMetadata>(key);
  if (!metadata) return;

  try {
    const sandbox = await VercelSandbox.reconnect(metadata.sandboxId, {
      githubToken: options.githubToken,
    });
    await sandbox.stop();
  } catch (err) {
    log.warn(
      "sandbox",
      `Release failed for sandbox ${metadata.sandboxId} (${threadKey}): ${String(err)}`,
    );
  }

  await redis.del(key);
}
