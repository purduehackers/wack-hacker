import { UserRole, isUserRole, type UserRole as UserRoleValue } from "@repo/shared/discord";
import { Transient } from "@repo/shared/errors";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";

import { RiskLevel, type RiskLevel as RiskLevelValue } from "./types.ts";

const APPROVAL_TTL_SECONDS = 15 * 60;

export interface SecondPartyApprovalRecord {
  readonly requesterUserId: string;
  readonly mode: "second-party";
  readonly minApproverRole: Exclude<UserRoleValue, typeof UserRole.Public>;
  readonly tool: string;
  readonly risk: RiskLevelValue;
}

export function approvalPolicyKey(sessionId: string, callId: string): string {
  return `policy:approval:${sessionId}:${callId}`;
}

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
        if (typeof value !== "object" || value === null)
          throw new Error("approval policy is malformed");
        const requesterUserId = Reflect.get(value, "requesterUserId");
        const mode = Reflect.get(value, "mode");
        const minApproverRole = Reflect.get(value, "minApproverRole");
        const tool = Reflect.get(value, "tool");
        const risk = Reflect.get(value, "risk");
        if (
          typeof requesterUserId !== "string" ||
          mode !== "second-party" ||
          !isUserRole(minApproverRole) ||
          minApproverRole === UserRole.Public ||
          typeof tool !== "string" ||
          (risk !== RiskLevel.Read && risk !== RiskLevel.Write && risk !== RiskLevel.Destructive)
        ) {
          throw new Error("approval policy is malformed");
        }
        return { requesterUserId, mode, minApproverRole, tool, risk };
      },
      catch: (cause) =>
        new Transient({ operation: "read second-party approval policy", detail: String(cause) }),
    });
  }
}
