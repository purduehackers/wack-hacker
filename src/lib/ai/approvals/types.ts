import type { AgentContext } from "../context.ts";

/** Options bound to a tool via the `approval()` marker. */
export interface ApprovalOptions {
  /**
   * Optional static reason shown in the approval prompt when the agent does
   * not supply one via `_reason`. Leave undefined to require the agent to
   * always justify each call at runtime.
   */
  reason?: string;
}

/**
 * Persisted approval state. Written by the wrapper, polled by the wrapper's
 * wait loop, and flipped by the Discord component handler. The status union
 * is inline so no exported string-union type escapes this module.
 */
export interface ApprovalState {
  id: string;
  status: "pending" | "approved" | "denied" | "timeout";
  delegateName?: string;
  toolName: string;
  input: unknown;
  reason: string;
  channelId: string;
  threadId?: string;
  messageId?: string;
  requesterUserId: string;
  decidedByUserId?: string;
  createdAt: string;
  decidedAt?: string;
}

/** Knobs for `ApprovalStore.waitFor()`. */
export interface WaitForOptions {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

/**
 * Injection points for `wrapApprovalTools()`. The `store` slot exists so tests
 * can swap in an `ApprovalStore` constructed against the in-memory Redis
 * fixture — Discord REST is mocked separately via `@discordjs/rest`.
 */
export interface WrapApprovalOptions {
  context: AgentContext;
  /** Subagent domain name (e.g. "github"). Omit for top-level orchestrator tools. */
  delegateName?: string;
  timeoutMs?: number;
  store?: ApprovalStoreLike;
}

/**
 * Minimal surface `wrapApprovalTools` needs from the store, so the concrete
 * class can live in a non-types file without creating a cycle.
 */
export interface ApprovalStoreLike {
  create(state: ApprovalState, ttlSeconds?: number): Promise<void>;
  get(id: string): Promise<ApprovalState | null>;
  setMessageId(id: string, messageId: string, ttlSeconds?: number): Promise<void>;
  decide(
    id: string,
    status: Exclude<ApprovalState["status"], "pending">,
    decidedByUserId: string | null,
  ): Promise<ApprovalState | null>;
  waitFor(id: string, opts?: WaitForOptions): Promise<ApprovalState>;
}

/** Arguments for `buildApprovalEmbed`. */
export interface BuildApprovalEmbedArgs {
  delegateName?: string;
  toolName: string;
  input: unknown;
  reason: string;
  timeoutMs: number;
}
