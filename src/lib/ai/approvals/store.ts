import { Redis } from "@upstash/redis";

import type { RedisLike } from "@/bot/types";

import type { ApprovalState, ApprovalStoreLike, WaitForOptions } from "./types.ts";

const KEY_PREFIX = "approval:";
const CLAIM_SUFFIX = ":claim";
const DEFAULT_TTL_SECONDS = 300;
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_INTERVAL_MS = 1500;

type DecisionPatch = Pick<ApprovalState, "status" | "decidedByUserId" | "decidedAt">;

/**
 * Upstash-backed store for pending tool-approval requests. State is TTL'd so
 * abandoned approvals expire without cleanup.
 *
 * Transitions from `pending` are atomic: `decide()` uses a separate claim key
 * set with `NX` so concurrent calls (e.g. a button click racing `waitFor`'s
 * timeout path) agree on a single winner. Readers merge the claim into the
 * primary row in `get()` so the winning decision is visible immediately, even
 * before the winner has finished writing the primary row back.
 */
export class ApprovalStore implements ApprovalStoreLike {
  private redis: RedisLike;

  constructor(redis?: RedisLike) {
    this.redis = redis ?? Redis.fromEnv();
  }

  private key(id: string): string {
    return `${KEY_PREFIX}${id}`;
  }

  private claimKey(id: string): string {
    return `${KEY_PREFIX}${id}${CLAIM_SUFFIX}`;
  }

  async create(state: ApprovalState, ttlSeconds: number = DEFAULT_TTL_SECONDS): Promise<void> {
    await this.redis.set(this.key(state.id), state, { ex: ttlSeconds });
  }

  async get(id: string): Promise<ApprovalState | null> {
    const [primary, claim] = await Promise.all([
      this.redis.get<ApprovalState>(this.key(id)),
      this.redis.get<DecisionPatch>(this.claimKey(id)),
    ]);
    if (!primary) return null;
    if (!claim) return primary;
    return { ...primary, ...claim };
  }

  async setMessageId(
    id: string,
    messageId: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    const primary = await this.redis.get<ApprovalState>(this.key(id));
    if (!primary) return;
    await this.redis.set(this.key(id), { ...primary, messageId }, { ex: ttlSeconds });
  }

  /**
   * Flip a pending approval to a final status atomically. Returns the updated
   * state, or `null` if the approval no longer exists (TTL expired between
   * creation and decision).
   *
   * The transition is serialized across concurrent callers via a Redis-level
   * `SET ... NX` on a separate claim key: the first writer wins, subsequent
   * writers see the claim, skip the primary write, and return the merged
   * state reflecting the winner's decision.
   */
  async decide(
    id: string,
    status: Exclude<ApprovalState["status"], "pending">,
    decidedByUserId: string | null,
  ): Promise<ApprovalState | null> {
    const decidedAt = new Date().toISOString();
    const patch: DecisionPatch = {
      status,
      decidedByUserId: decidedByUserId ?? undefined,
      decidedAt,
    };

    const claimed = await this.redis.set(this.claimKey(id), patch, {
      nx: true,
      ex: DEFAULT_TTL_SECONDS,
    });

    const primary = await this.redis.get<ApprovalState>(this.key(id));
    if (!primary) return null;

    if (claimed === null) {
      // Lost the race — read the winner's claim and return the merged view.
      const winner = await this.redis.get<DecisionPatch>(this.claimKey(id));
      return winner ? { ...primary, ...winner } : primary;
    }

    // Won the race — write the updated primary so readers without the claim
    // merge logic still see the terminal status.
    const updated: ApprovalState = { ...primary, ...patch };
    await this.redis.set(this.key(id), updated, { ex: DEFAULT_TTL_SECONDS });
    return updated;
  }

  /**
   * Poll for a terminal status up to `timeoutMs`. Resolves to the final state
   * whether the approval was decided, expired (TTL), or the polling loop hit
   * its own timeout. Honors `AbortSignal` — rejects with `Error("aborted")`.
   */
  async waitFor(id: string, opts: WaitForOptions = {}): Promise<ApprovalState> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (opts.signal?.aborted) throw new Error("aborted");
      const state = await this.get(id);
      if (!state) return this.syntheticTimeout(id);
      if (state.status !== "pending") return state;
      await sleep(intervalMs, opts.signal);
    }

    // Polling deadline hit — flip the row so a late click can't still execute.
    const decided = await this.decide(id, "timeout", null);
    return decided ?? this.syntheticTimeout(id);
  }

  private syntheticTimeout(id: string): ApprovalState {
    return {
      id,
      status: "timeout",
      toolName: "",
      input: null,
      reason: "",
      channelId: "",
      requesterUserId: "",
      createdAt: "",
    };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
