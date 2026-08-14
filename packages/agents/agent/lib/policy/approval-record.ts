import { UserRole, type UserRole as UserRoleValue } from "@repo/shared/discord";
import { Transient } from "@repo/shared/errors";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import { z } from "zod";

import { storedJson } from "../schema.ts";
import { RiskLevel, type RiskLevel as RiskLevelValue } from "./types.ts";

const APPROVAL_TTL_SECONDS = 15 * 60;

export interface SecondPartyApprovalRecord {
  readonly requesterUserId: string;
  readonly mode: "second-party";
  readonly minApproverRole: Exclude<UserRoleValue, typeof UserRole.Public>;
  readonly tool: string;
  readonly risk: RiskLevelValue;
}

/**
 * Exactly what `putSecondParty` writes. Upstash may return it as the stored JSON
 * text rather than an object, so `storedJson` accepts both forms. The previous
 * hand-written decoder rejected the text form outright.
 */
const secondPartyApprovalSchema = storedJson(
  z.strictObject({
    requesterUserId: z.string(),
    mode: z.literal("second-party"),
    minApproverRole: z.enum(UserRole).exclude(["Public"]),
    tool: z.string(),
    risk: z.enum(RiskLevel),
  }),
);

function approvalPolicyKey(sessionId: string, callId: string): string {
  return `policy:approval:${sessionId}:${callId}`;
}

/**
 * Redis-backed record of pending second-party approvals, keyed by session and
 * call. Records expire after fifteen minutes, so an unanswered approval lapses
 * instead of staying claimable forever. Reads fail with `Transient`, and a
 * malformed stored record is a failure, never a silent grant.
 */
export class ApprovalPolicyStore {
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  async putSecondParty(
    sessionId: string,
    callId: string,
    record: SecondPartyApprovalRecord,
  ): Promise<Result<void, Transient>> {
    return Result.tryPromise({
      try: async () => {
        await this.redis.set(approvalPolicyKey(sessionId, callId), record, {
          ex: APPROVAL_TTL_SECONDS,
        });
      },
      catch: (cause) =>
        new Transient({ operation: "persist second-party approval policy", detail: String(cause) }),
    });
  }

  async read(
    sessionId: string,
    callId: string,
  ): Promise<Result<SecondPartyApprovalRecord | undefined, Transient>> {
    return Result.tryPromise({
      try: async () => {
        const value: unknown = await this.redis.get(approvalPolicyKey(sessionId, callId));
        if (value === null || value === undefined) return undefined;
        const parsed = secondPartyApprovalSchema.safeParse(value);
        if (!parsed.success) {
          throw new Error(`approval policy is malformed: ${z.prettifyError(parsed.error)}`);
        }
        return parsed.data;
      },
      catch: (cause) =>
        new Transient({ operation: "read second-party approval policy", detail: String(cause) }),
    });
  }
}
