import { Engine, PolicyError, module } from "@rayhanadev/verdex";
import { UserRole } from "@repo/shared/discord";
import { InvariantViolated } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { z } from "zod";

import {
  CapabilityKind,
  Confirmation,
  PolicySource,
  RiskLevel,
  type CapabilityDecision,
  type CapabilityDescriptor,
  type PolicyEvaluationContext,
  type PolicyPrincipal,
} from "./types.ts";

const roleSchema = z.enum([UserRole.Public, UserRole.Organizer, UserRole.Admin]);
const inputSchema = z.strictObject({
  principal: z.strictObject({
    userId: z.string().min(1),
    role: roleSchema,
    source: z.enum([PolicySource.Chat, PolicySource.Scheduled]),
  }),
  budget: z
    .strictObject({ used: z.number().nonnegative(), limit: z.number().positive() })
    .optional(),
  capability: z.strictObject({
    kind: z.enum([CapabilityKind.Subagent, CapabilityKind.Tool, CapabilityKind.Skill]),
    name: z.string().min(1),
    minRole: roleSchema,
    risk: z.enum([RiskLevel.Read, RiskLevel.Write, RiskLevel.Destructive]),
    confirmation: z
      .enum([Confirmation.None, Confirmation.Self, Confirmation.SecondParty])
      .optional(),
  }),
});

type PolicyInput = z.infer<typeof inputSchema>;
const ROLE_LEVEL: Record<PolicyPrincipal["role"], number> = {
  [UserRole.Public]: 0,
  [UserRole.Organizer]: 1,
  [UserRole.Admin]: 2,
};

function authorized(input: PolicyInput): boolean {
  return ROLE_LEVEL[input.principal.role] >= ROLE_LEVEL[input.capability.minRole];
}

function confirmationFor(capability: PolicyInput["capability"]): Confirmation {
  if (capability.confirmation !== undefined) return capability.confirmation;
  if (capability.risk === RiskLevel.Read) return Confirmation.None;
  if (capability.risk === RiskLevel.Write) return Confirmation.None;
  return Confirmation.Self;
}

function withinBudget(input: PolicyInput): boolean {
  return (
    input.principal.role !== UserRole.Public ||
    input.budget === undefined ||
    input.budget.used < input.budget.limit
  );
}

/** Every policy dimension has an explicit deny fallback. */
const capabilities = module("capabilities", { input: inputSchema })
  .default("discover", false)
  .when("discover", (ctx) => authorized(ctx.input), true)
  .default("execute", false)
  .when("execute", (ctx) => authorized(ctx.input) && withinBudget(ctx.input), true)
  .default("approve", "deny" as const)
  .complete("approve", (ctx) =>
    authorized(ctx.input) && withinBudget(ctx.input)
      ? ctx.input.principal.source === PolicySource.Scheduled
        ? Confirmation.None
        : confirmationFor(ctx.input.capability)
      : undefined,
  );

const engine = new Engine().add(capabilities);

/** Stable policy entry point. Engine/schema failures become typed, fail-closed results. */
export function decideCapability(
  principal: PolicyPrincipal,
  capability: CapabilityDescriptor,
  context: PolicyEvaluationContext = {},
): Result<CapabilityDecision, InvariantViolated> {
  return Result.try({
    try: () => {
      const input = {
        principal,
        capability,
        ...(context.budget === undefined ? {} : { budget: context.budget }),
      } satisfies PolicyInput;
      const discover = engine.capabilities.discover({ input });
      const execute = engine.capabilities.execute({ input });
      const approve = engine.capabilities.approve({ input });
      const canDiscover = discover.defined && discover.result;
      const canExecute = execute.defined && execute.result;
      return {
        discover: canDiscover,
        execute: canExecute,
        approve: approve.defined ? approve.result : "deny",
        ...(!canDiscover
          ? { denial: "role" as const }
          : !canExecute
            ? { denial: "budget" as const }
            : {}),
      };
    },
    catch: (cause) =>
      new InvariantViolated({
        invariant: "Verdex capability policy evaluates synchronously",
        detail: cause instanceof PolicyError ? cause.message : String(cause),
      }),
  });
}
