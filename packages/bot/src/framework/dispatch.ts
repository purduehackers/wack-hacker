/**
 * Routes an inbound interaction to its command.
 *
 * Two guarantees, both learned from the prior dispatcher:
 *
 * 1. **The user always gets a reply.** An unknown command name or a failing
 *    handler produces an ephemeral message, never a silent acknowledgement.
 *    Discord shows an unanswered interaction as "the application did not
 *    respond", which reads as the whole bot being broken.
 * 2. **Failures are classified, not swallowed.** Every outcome passes through
 *    `instrument`, so an expected failure is counted and a defect is reported —
 *    exactly once, from one place.
 */

import { InvariantViolated, messageOf, Transient } from "@repo/shared/errors";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import { instrument } from "@repo/shared/result/observe";
import type { Reporter } from "@repo/shared/result/observe";
import { MessageFlags } from "discord.js";
import type { AutocompleteInteraction, ChatInputCommandInteraction, Interaction } from "discord.js";

import type { HitlInteractionHandler } from "../agent/hitl/interaction.ts";
import type { SlashCommand } from "./commands.ts";
import { traceOperation } from "./observability.ts";

/**
 * Fills an autocomplete option.
 *
 * Deliberately unlike the command path in two ways. There is no interaction
 * claim: Discord sends one of these per keystroke, each with its own id, so a
 * claim would be a Redis write per character to deduplicate something that is
 * already unique. And there is no user-facing failure notice, because an
 * autocomplete has no channel to speak on — a failure leaves the person's typed
 * text untouched, which is the correct outcome for an option that accepts free
 * text anyway.
 */
async function dispatchAutocomplete(
  interaction: AutocompleteInteraction,
  deps: DispatchDeps,
): Promise<void> {
  const command = deps.commands.find((entry) => entry.builder.name === interaction.commandName);
  const fill = command?.autocomplete;
  if (fill === undefined) return;

  await instrument(`interaction.autocomplete.${interaction.commandName}`, deps.reporter, () =>
    Result.tryPromise({
      try: () => fill(interaction),
      catch: (cause) => cause,
    }).then((settled) => (Result.isError(settled) ? Result.err(settled.error) : settled.value)),
  );
}

interface DispatchDeps {
  readonly commands: readonly SlashCommand[];
  readonly reporter: Reporter;
  readonly hitl: HitlInteractionHandler;
  readonly redis: RedisClient;
}

/** Best-effort user-facing failure notice. */
async function notify(interaction: ChatInputCommandInteraction, body: string): Promise<void> {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: body, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: body, flags: MessageFlags.Ephemeral });
    }
  } catch (cause) {
    // The interaction token can expire while a handler runs. Nothing left to
    // tell the user, so record it and move on rather than masking the original.
    console.warn("failed to deliver interaction failure notice", cause);
  }
}

const INTERACTION_CLAIM_TTL_SECONDS = 24 * 60 * 60;

async function claimCommandInteraction(
  redis: RedisClient,
  interactionId: string,
): Promise<Result<boolean, Transient>> {
  return Result.tryPromise({
    try: async () =>
      (await redis.set(`bot:interaction:${interactionId}`, "1", {
        nx: true,
        ex: INTERACTION_CLAIM_TTL_SECONDS,
      })) === "OK",
    catch: (cause) =>
      new Transient({
        operation: "claim Discord interaction",
        detail: messageOf(cause),
      }),
  });
}

async function dispatchInteractionInSpan(
  interaction: Interaction,
  deps: DispatchDeps,
): Promise<void> {
  if (await deps.hitl(interaction)) return;
  if (interaction.isAutocomplete()) return dispatchAutocomplete(interaction, deps);
  if (!interaction.isChatInputCommand()) return;

  const claimed = await claimCommandInteraction(deps.redis, interaction.id);
  if (Result.isError(claimed)) {
    deps.reporter.emit({
      op: "interaction.claim",
      status: "error",
      errorTag: claimed.error._tag,
      errorMessage: claimed.error.message,
    });
    await notify(interaction, "The bot is temporarily unavailable. Please try again.");
    return;
  }
  if (!claimed.value) return;

  const command = deps.commands.find((entry) => entry.builder.name === interaction.commandName);

  if (command === undefined) {
    // Registered upstream but absent here — a deploy skew, which is our bug.
    deps.reporter.captureDefect(
      new InvariantViolated({
        invariant: "registered-command-exists",
        detail: `no handler for /${interaction.commandName}`,
      }),
      { op: "interaction.command" },
    );
    await notify(interaction, "That command is no longer available.");
    return;
  }

  const outcome = await instrument(
    `interaction.command.${interaction.commandName}`,
    deps.reporter,
    () =>
      Result.tryPromise({
        try: () => command.execute(interaction),
        catch: (cause) => cause,
      }).then((settled) =>
        // A handler that throws instead of returning is itself a failure; flatten
        // so both shapes land on the same path.
        Result.isError(settled) ? Result.err(settled.error) : settled.value,
      ),
  );

  if (Result.isError(outcome)) {
    await notify(interaction, "Something went wrong. Please try again later.");
  }
}

export async function dispatchInteraction(
  interaction: Interaction,
  deps: DispatchDeps,
): Promise<void> {
  return traceOperation(
    "interaction.dispatch",
    () => dispatchInteractionInSpan(interaction, deps),
    { "discord.interaction.kind": interaction.type },
  );
}
