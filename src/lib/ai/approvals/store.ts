import { Redis } from "@upstash/redis";

import type { RedisLike } from "@/bot/types";

import type { ApprovalState, ApprovalStoreLike, WaitForOptions } from "./types.ts";

const KEY_PREFIX = "approval:";
const TTL_SECONDS = 300;
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_INTERVAL_MS = 1500;

/**
 * Upstash-backed store for pending tool-approval requests. State is TTL'd so
 * abandoned approvals expire without cleanup. Mirrors the shape of
 * `ConversationStore` — accepts an injected `RedisLike` so tests can run
 * against the in-memory fixture.
 */
export class ApprovalStore implements ApprovalStoreLike {
  private redis: RedisLike;

  constructor(redis?: RedisLike) {
    this.redis = redis ?? Redis.fromEnv();
  }

  private key(id: string): string {
    return `${KEY_PREFIX}${id}`;
  }

  async create(state: ApprovalState): Promise<void> {
    await this.redis.set(this.key(state.id), state, { ex: TTL_SECONDS });
  }

  async get(id: string): Promise<ApprovalState | null> {
    return this.redis.get<ApprovalState>(this.key(id));
  }

  async setMessageId(id: string, messageId: string): Promise<void> {
    const state = await this.get(id);
    if (!state) return;
    await this.redis.set(this.key(id), { ...state, messageId }, { ex: TTL_SECONDS });
  }

  /**
   * Flip a pending approval to a final status. Returns the updated state, or
   * `null` if the approval no longer exists (TTL expired between creation
   * and decision). No-op if the approval is already in a non-pending state —
   * returns the existing row so callers can observe who decided first.
   */
  async decide(
    id: string,
    status: Exclude<ApprovalState["status"], "pending">,
    decidedByUserId: string | null,
  ): Promise<ApprovalState | null> {
    const state = await this.get(id);
    if (!state) return null;
    if (state.status !== "pending") return state;
    const updated: ApprovalState = {
      ...state,
      status,
      decidedByUserId: decidedByUserId ?? undefined,
      decidedAt: new Date().toISOString(),
    };
    await this.redis.set(this.key(id), updated, { ex: TTL_SECONDS });
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
