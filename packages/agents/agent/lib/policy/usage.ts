import { serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { defineHook } from "eve/hooks";

import { BudgetStore } from "./budget.ts";
import { requirePrincipal } from "./principal.ts";

/**
 * One safe, structured usage event per provider call plus the durable daily
 * token charge. Eve owns pricing normalization, so this consumes its exported
 * usage contract rather than maintaining a second models.dev catalog.
 */
export function defineUsageHook(budgets: BudgetStore) {
  return defineHook({
    events: {
      async "step.completed"(event, ctx) {
        const usage = event.data.usage;
        if (usage === undefined) return;

        console.info(
          JSON.stringify({
            event: "ai.usage",
            agent: ctx.agent.name,
            sessionId: ctx.session.id,
            turnId: event.data.turnId,
            stepIndex: event.data.stepIndex,
            finishReason: event.data.finishReason,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            costUsd: usage.costUsd,
            gatewayGenerationId: event.data.providerMetadata?.gateway.generationId,
          }),
        );

        const principal = requirePrincipal(ctx.session.auth.current);
        if (Result.isError(principal)) return;
        const tokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
        if (tokens === 0) return;
        const recorded = await budgets.add(principal.value.userId, tokens);
        if (Result.isError(recorded)) {
          console.warn("AI usage budget write unavailable", serializeError(recorded.error));
        }
      },
    },
  });
}
