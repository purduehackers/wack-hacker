/**
 * Routes an inbound interaction to its command.
 *
 * Two guarantees, both learned from the legacy dispatcher:
 *
 * 1. **The user always gets a reply.** An unknown command name or a failing
 *    handler produces an ephemeral message, never a silent acknowledgement.
 *    Discord shows an unanswered interaction as "the application did not
 *    respond", which reads as the whole bot being broken.
 * 2. **Failures are classified, not swallowed.** Every outcome passes through
 *    `instrument`, so an expected failure is counted and a defect is reported —
 *    exactly once, from one place.
 */

import { InvariantViolated, serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { instrument } from "@repo/shared/result/observe";
import type { Reporter } from "@repo/shared/result/observe";
import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction, Interaction } from "discord.js";

import type { SlashCommand } from "./commands.ts";

export interface DispatchDeps {
  readonly commands: readonly SlashCommand[];
  readonly reporter: Reporter;
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

export async function dispatchInteraction(
  interaction: Interaction,
  deps: DispatchDeps,
): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

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
    await notify(interaction, `Something went wrong: ${serializeError(outcome.error).message}`);
  }
}
