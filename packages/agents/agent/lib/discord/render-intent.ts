/** Durable desired-state publication plus best-effort bot wakeups. */

import type { ConversationStore } from "@repo/shared/conversations";
import { BOT_ROUTES } from "@repo/shared/wire";
import type { ParkedPayload, RenderIntent } from "@repo/shared/wire";

import { traceHeaders } from "../telemetry.ts";

export interface FooterInput {
  readonly referenceId?: string;
  readonly durationMs?: number;
  readonly tokens?: number;
  readonly toolCalls?: number;
}

export function renderFooter(input: FooterInput): string {
  const parts: string[] = [];
  if (input.referenceId !== undefined) parts.push(`\`${input.referenceId}\``);
  if (input.durationMs !== undefined) parts.push(`${(input.durationMs / 1_000).toFixed(1)}s`);
  if (input.tokens !== undefined) parts.push(`${input.tokens.toLocaleString("en-US")} tokens`);
  if (input.toolCalls !== undefined && input.toolCalls > 0) {
    parts.push(`${input.toolCalls} tool call${input.toolCalls === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

export interface RenderPublisherDeps {
  readonly store: ConversationStore["renderPublication"];
  readonly botUrl: () => Promise<string>;
  readonly botSecret: string;
}

export function createRenderPublisher(deps: RenderPublisherDeps) {
  return {
    publish: async (intent: RenderIntent): Promise<boolean> => {
      const publication = await deps.store.publish(intent);
      if (!publication.accepted) return false;
      if (!publication.shouldWake) return true;

      // Redis is the durable path. This small callback only avoids waiting for a
      // replacement bot's startup/periodic recovery sweep.
      try {
        const botUrl = await deps.botUrl();
        const response = await fetch(new URL(BOT_ROUTES.render, botUrl), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${deps.botSecret}`,
            ...traceHeaders(),
          },
          body: JSON.stringify({ dispatchId: intent.dispatchId }),
          signal: AbortSignal.timeout(3_000),
        });
        if (!response.ok) throw new Error(`bot render callback returned ${response.status}`);
      } catch (cause) {
        console.warn("bot render callback failed; Redis recovery remains pending", cause);
      }
      return true;
    },

    settleAndPark: (intent: RenderIntent, parked: ParkedPayload): Promise<number | undefined> =>
      deps.store.settleAndPark(intent, parked),
  };
}
