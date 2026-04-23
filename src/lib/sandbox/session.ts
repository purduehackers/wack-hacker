import type { RedisLike } from "@/bot/types";

import type {
  GetOrCreateSessionParams,
  HibernateSessionOptions,
  ReleaseSessionOptions,
  SandboxProvider,
  SandboxSession,
  SandboxSessionMetadata,
} from "./types.ts";

import { createWideLogger } from "../logging/wide.ts";
import { countMetric, recordDuration } from "../metrics.ts";
import { withSpan } from "../otel/tracing.ts";
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
  return `wack-hacker/${slug}-${suffix}`;
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
  return withSpan(
    "sandbox.session.get_or_create",
    { "sandbox.thread_key": params.threadKey, "sandbox.repo": params.repo },
    async (span) => {
      const logger = createWideLogger({
        op: "sandbox.session.get_or_create",
        sandbox: { thread_key: params.threadKey, repo: params.repo },
      });
      const startTime = Date.now();
      try {
        const redis = resolveRedis(params.redis);
        const provider = resolveProvider(params.provider);
        const cached = await redis.get<SandboxSessionMetadata>(redisKey(params.threadKey));

        const liveReuse = await tryLiveReuse(cached, params, redis, provider);
        if (liveReuse) {
          countMetric("sandbox.session.reused");
          span.setAttribute("sandbox.outcome", "reused");
          logger.emit({
            outcome: "reused",
            duration_ms: Date.now() - startTime,
            sandbox_id: liveReuse.metadata.sandboxId,
          });
          return liveReuse;
        }

        if (cached && cached.repo !== params.repo) {
          await discardStaleSession(cached, params, redis, provider);
          countMetric("sandbox.session.discarded_stale");
          logger.set({ discarded: { prior_repo: cached.repo } });
        }

        const result = await provisionFreshSession(params, redis, provider);
        const outcome = result.metadata.sandboxId && cached?.hibernated ? "resumed" : "provisioned";
        countMetric("sandbox.session.provisioned", { outcome });
        span.setAttribute("sandbox.outcome", outcome);
        logger.emit({
          outcome,
          duration_ms: Date.now() - startTime,
          sandbox_id: result.metadata.sandboxId,
          branch: result.metadata.branch,
        });
        return result;
      } catch (err) {
        logger.error(err as Error);
        logger.emit({ outcome: "error", duration_ms: Date.now() - startTime });
        throw err;
      } finally {
        recordDuration("sandbox.session.get_or_create_duration", Date.now() - startTime);
      }
    },
  );
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
    return { sandbox, metadata, fresh: false };
  } catch (err) {
    countMetric("sandbox.session.reconnect_failed");
    createWideLogger({
      op: "sandbox.session.reconnect",
      sandbox: { thread_key: params.threadKey, sandbox_id: cached.sandboxId },
    }).emit({ outcome: "failed", reason: String(err) });
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
  const logger = createWideLogger({
    op: "sandbox.session.discard_stale",
    sandbox: {
      thread_key: params.threadKey,
      sandbox_id: cached.sandboxId,
      prior_repo: cached.repo,
      new_repo: params.repo,
    },
  });
  if (!cached.hibernated) {
    try {
      const old = await provider.reconnect(cached.sandboxId, {
        githubToken: params.githubToken,
      });
      await old.stop();
      logger.emit({ outcome: "stopped" });
    } catch (err) {
      logger.warn("failed to stop stale sandbox", { reason: String(err) });
      logger.emit({ outcome: "stop_failed" });
    }
  } else {
    logger.emit({ outcome: "hibernated_discarded" });
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
  return withSpan("sandbox.session.release", { "sandbox.thread_key": threadKey }, async () => {
    const logger = createWideLogger({
      op: "sandbox.session.release",
      sandbox: { thread_key: threadKey },
    });
    const redis = resolveRedis(options.redis);
    const provider = resolveProvider(options.provider);
    const key = redisKey(threadKey);
    const metadata = await redis.get<SandboxSessionMetadata>(key);
    if (!metadata) {
      logger.emit({ outcome: "no-session" });
      return;
    }

    logger.set({ sandbox: { sandbox_id: metadata.sandboxId, hibernated: metadata.hibernated } });

    if (!metadata.hibernated) {
      try {
        const sandbox = await provider.reconnect(metadata.sandboxId, {
          githubToken: options.githubToken,
        });
        await sandbox.stop();
        countMetric("sandbox.session.released");
        logger.emit({ outcome: "stopped" });
      } catch (err) {
        countMetric("sandbox.session.release_failed");
        logger.warn("release failed", { reason: String(err) });
        logger.emit({ outcome: "release_failed" });
      }
    } else {
      countMetric("sandbox.session.released", { hibernated: "true" });
      logger.emit({ outcome: "released_hibernated" });
    }

    await redis.del(key);
  });
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
  return withSpan(
    "sandbox.session.hibernate",
    { "sandbox.thread_key": threadKey },
    async (span) => {
      const logger = createWideLogger({
        op: "sandbox.session.hibernate",
        sandbox: { thread_key: threadKey },
      });
      const redis = resolveRedis(options.redis);
      const provider = resolveProvider(options.provider);
      const metadata = await redis.get<SandboxSessionMetadata>(redisKey(threadKey));
      if (!metadata) {
        span.setAttribute("sandbox.outcome", "skipped-missing");
        logger.emit({ outcome: "skipped-missing" });
        return "skipped-missing";
      }
      if (metadata.hibernated) {
        span.setAttribute("sandbox.outcome", "skipped-already");
        logger.emit({ outcome: "skipped-already", sandbox_id: metadata.sandboxId });
        return "skipped-already";
      }

      logger.set({ sandbox: { sandbox_id: metadata.sandboxId } });

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
          logger.warn("wip commit before hibernation failed", { reason: String(err) });
        }

        const snap = await sandbox.snapshot();
        const next: SandboxSessionMetadata = {
          ...metadata,
          hibernated: true,
          snapshotId: snap.snapshotId,
        };
        await writeSession(threadKey, next, redis);
        span.setAttribute("sandbox.outcome", "hibernated");
        logger.emit({ outcome: "hibernated", snapshot_id: snap.snapshotId });
        return "hibernated";
      } catch (err) {
        countMetric("sandbox.session.hibernate_failed");
        span.setAttribute("sandbox.outcome", "hibernate-failed");
        logger.error(err as Error);
        logger.emit({ outcome: "hibernate_failed" });
        return "skipped-missing";
      }
    },
  );
}
