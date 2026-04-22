import { log } from "evlog";

import type { RedisLike } from "@/bot/types";

import type {
  GetOrCreateSessionParams,
  HibernateSessionOptions,
  ReleaseSessionOptions,
  SandboxProvider,
  SandboxSession,
  SandboxSessionMetadata,
} from "./types.ts";

import { resolveOnProvisioned, resolveProvider, resolveRedis } from "./session-deps.ts";

export type {
  GetOrCreateSessionParams,
  HibernateSessionOptions,
  ReleaseSessionOptions,
  SandboxProvider,
  SandboxSession,
  SandboxSessionMetadata,
} from "./types.ts";

const KEY_PREFIX = "sandbox:session:";
const TTL_SECONDS = 35 * 60;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
/** Snapshots live long enough to survive a paused conversation; cleared on full release. */
const HIBERNATED_TTL_SECONDS = 6 * 60 * 60;

function redisKey(threadKey: string): string {
  return `${KEY_PREFIX}${threadKey}`;
}

function generateBranchName(repo: string): string {
  const [, name] = repo.split("/");
  const slug = (name ?? "repo").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `phoenix-agent/${slug}-${suffix}`;
}

/** Exposed so the lifecycle workflow can fetch the current metadata. */
export async function readSession(
  threadKey: string,
  redis?: RedisLike,
): Promise<SandboxSessionMetadata | null> {
  return resolveRedis(redis).get<SandboxSessionMetadata>(redisKey(threadKey));
}

/** Exposed for the lifecycle workflow. */
export async function writeSession(
  threadKey: string,
  metadata: SandboxSessionMetadata,
  redis?: RedisLike,
): Promise<void> {
  const ttl = metadata.hibernated ? HIBERNATED_TTL_SECONDS : TTL_SECONDS;
  await resolveRedis(redis).set(redisKey(threadKey), metadata, { ex: ttl });
}

/**
 * Fetch the session for this Discord thread, reconnecting to the existing
 * sandbox if one is cached. Provisions a fresh sandbox — clone, branch, git
 * identity, toolchain — when no session exists or the cached one has
 * expired. When the previous session was hibernated (see
 * `sandboxLifecycleWorkflow`), a fresh sandbox is booted from its snapshot
 * so the WIP branch + working tree carry over.
 *
 * `extendTimeout` is called on every access so active threads keep the
 * sandbox alive past its natural deadline. Returns a `SandboxSession` with
 * `fresh: true` when a new sandbox was created (the caller can log/meter it).
 */
export async function getOrCreateSession(
  params: GetOrCreateSessionParams,
): Promise<SandboxSession> {
  const redis = resolveRedis(params.redis);
  const provider = resolveProvider(params.provider);
  const cached = await redis.get<SandboxSessionMetadata>(redisKey(params.threadKey));

  const liveReuse = await tryLiveReuse(cached, params, redis, provider);
  if (liveReuse) return liveReuse;

  if (cached && cached.repo !== params.repo) {
    await discardStaleSession(cached, params, redis, provider);
  }

  return provisionFreshSession(params, redis, provider);
}

async function tryLiveReuse(
  cached: SandboxSessionMetadata | null,
  params: GetOrCreateSessionParams,
  redis: RedisLike,
  provider: SandboxProvider,
): Promise<SandboxSession | null> {
  if (!cached) return null;
  if (cached.repo !== params.repo) return null;
  if (cached.hibernated) return null;
  if (cached.expiresAt <= Date.now() + 60_000) return null;

  try {
    const sandbox = await provider.reconnect(cached.sandboxId, {
      githubToken: params.githubToken,
      expiresAt: cached.expiresAt,
    });
    const bump = await sandbox.extendTimeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const metadata: SandboxSessionMetadata = {
      ...cached,
      expiresAt: bump.expiresAt,
      lastUsedAt: Date.now(),
    };
    await writeSession(params.threadKey, metadata, redis);
    log.info("sandbox", `Reused sandbox ${cached.sandboxId} for thread ${params.threadKey}`);
    return { sandbox, metadata, fresh: false };
  } catch (err) {
    log.warn(
      "sandbox",
      `Reconnect failed for sandbox ${cached.sandboxId}: ${String(err)}. Provisioning fresh.`,
    );
    await redis.del(redisKey(params.threadKey));
    return null;
  }
}

async function discardStaleSession(
  cached: SandboxSessionMetadata,
  params: GetOrCreateSessionParams,
  redis: RedisLike,
  provider: SandboxProvider,
): Promise<void> {
  log.warn(
    "sandbox",
    `Repo changed for thread ${params.threadKey} (${cached.repo} → ${params.repo}); discarding old session`,
  );
  if (!cached.hibernated) {
    try {
      const old = await provider.reconnect(cached.sandboxId, {
        githubToken: params.githubToken,
      });
      await old.stop();
    } catch (err) {
      log.warn("sandbox", `Failed to stop stale sandbox ${cached.sandboxId}: ${String(err)}`);
    }
  }
  await redis.del(redisKey(params.threadKey));
}

async function provisionFreshSession(
  params: GetOrCreateSessionParams,
  redis: RedisLike,
  provider: SandboxProvider,
): Promise<SandboxSession> {
  const key = redisKey(params.threadKey);
  const freshCached = await redis.get<SandboxSessionMetadata>(key);
  const resumeSnapshot =
    freshCached?.hibernated && freshCached.snapshotId && freshCached.repo === params.repo
      ? freshCached.snapshotId
      : params.baseSnapshotId;
  const branch = freshCached?.branch ?? params.branch ?? generateBranchName(params.repo);
  const isResume = Boolean(freshCached?.hibernated && freshCached.snapshotId);

  const sandbox = await provider.create({
    repo: params.repo,
    githubToken: params.githubToken,
    branch,
    baseBranch: params.baseBranch,
    gitUser: params.gitUser,
    baseSnapshotId: resumeSnapshot,
    timeoutMs: params.timeoutMs,
    skipCloneAndBranch: isResume,
  });

  const metadata: SandboxSessionMetadata = {
    sandboxId: sandbox.name,
    repo: params.repo,
    branch,
    repoDir: sandbox.workingDirectory,
    expiresAt: Date.now() + (params.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    lastUsedAt: Date.now(),
  };

  await writeSession(params.threadKey, metadata, redis);
  log.info(
    "sandbox",
    `${isResume ? "Resumed" : "Provisioned"} sandbox ${sandbox.name} for thread ${params.threadKey}`,
  );

  const onProvisioned = resolveOnProvisioned(params.onProvisioned);
  await onProvisioned(params.threadKey);

  return { sandbox, metadata, fresh: true };
}

/**
 * Release the sandbox for this thread (if any). Safe to call when no session
 * exists. Errors are logged but never thrown — conversation cleanup must not
 * fail because a sandbox release hiccupped.
 */
export async function releaseSession(
  threadKey: string,
  options: ReleaseSessionOptions = {},
): Promise<void> {
  const redis = resolveRedis(options.redis);
  const provider = resolveProvider(options.provider);
  const key = redisKey(threadKey);
  const metadata = await redis.get<SandboxSessionMetadata>(key);
  if (!metadata) return;

  if (!metadata.hibernated) {
    try {
      const sandbox = await provider.reconnect(metadata.sandboxId, {
        githubToken: options.githubToken,
      });
      await sandbox.stop();
    } catch (err) {
      log.warn(
        "sandbox",
        `Release failed for sandbox ${metadata.sandboxId} (${threadKey}): ${String(err)}`,
      );
    }
  }

  await redis.del(key);
}

/**
 * Hibernate the cached sandbox for `threadKey`: commit any WIP, snapshot the
 * filesystem (stops the VM), and flip the session metadata to
 * `hibernated: true` with the new `snapshotId`. Called by the lifecycle
 * workflow when the sandbox approaches its deadline but the conversation is
 * still paused. Returns the action taken for telemetry.
 */
export async function hibernateSession(
  threadKey: string,
  options: HibernateSessionOptions = {},
): Promise<"hibernated" | "skipped-missing" | "skipped-already"> {
  const redis = resolveRedis(options.redis);
  const provider = resolveProvider(options.provider);
  const metadata = await redis.get<SandboxSessionMetadata>(redisKey(threadKey));
  if (!metadata) return "skipped-missing";
  if (metadata.hibernated) return "skipped-already";

  try {
    const sandbox = await provider.reconnect(metadata.sandboxId, {
      githubToken: options.githubToken,
      expiresAt: metadata.expiresAt,
    });

    // Best-effort commit of uncommitted WIP so resume starts from a clean tree.
    try {
      await sandbox.exec(
        "git add -A && git diff --cached --quiet || git commit -m 'wip: hibernation checkpoint'",
        {
          cwd: metadata.repoDir,
          timeoutMs: 30_000,
        },
      );
    } catch (err) {
      log.warn("sandbox", `WIP commit before hibernation failed (${threadKey}): ${String(err)}`);
    }

    const snap = await sandbox.snapshot();
    const next: SandboxSessionMetadata = {
      ...metadata,
      hibernated: true,
      snapshotId: snap.snapshotId,
    };
    await writeSession(threadKey, next, redis);
    log.info(
      "sandbox",
      `Hibernated ${metadata.sandboxId} → snapshot ${snap.snapshotId} (${threadKey})`,
    );
    return "hibernated";
  } catch (err) {
    log.warn("sandbox", `Hibernate failed for ${threadKey}: ${String(err)}`);
    return "skipped-missing";
  }
}
