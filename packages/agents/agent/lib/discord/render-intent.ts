/** Durable desired-state publication plus best-effort bot wakeups. */

import type { ConversationStore } from "@repo/shared/conversations";
import { BOT_ROUTES } from "@repo/shared/wire";
import type { ParkedPayload, RenderArtifact, RenderIntent } from "@repo/shared/wire";

type RenderPublication = Awaited<ReturnType<ConversationStore["render"]["publish"]>>;

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
  readonly store: Pick<ConversationStore["render"], "publish" | "settleAndPark">;
  readonly botUrl: () => Promise<string>;
  readonly botSecret: string;
  readonly artifacts: (dispatchId: string) => Promise<RenderArtifact[] | undefined>;
}

export function createRenderPublisher(deps: RenderPublisherDeps) {
  // Completion also passes through settleAndPark, which replaces earlier frames.
  // Resolve files at both write boundaries so the terminal frame retains them.
  const withArtifacts = async (intent: RenderIntent): Promise<RenderIntent> => {
    if (intent.phase !== "completed") return intent;
    const artifacts = await deps.artifacts(intent.dispatchId);
    return artifacts === undefined ? intent : { ...intent, artifacts };
  };

  return {
    publish: async (intent: RenderIntent): Promise<RenderPublication> => {
      const publication = await deps.store.publish(await withArtifacts(intent));
      if (!publication.accepted) return publication;
      if (!publication.shouldWake) return publication;

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
      return publication;
    },

    settleAndPark: async (
      intent: RenderIntent,
      parked: ParkedPayload,
    ): Promise<number | undefined> => deps.store.settleAndPark(await withArtifacts(intent), parked),
  };
}
