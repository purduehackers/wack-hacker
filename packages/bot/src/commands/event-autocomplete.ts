/**
 * The `event` option's autocomplete, shared by `/image-drop` and `/hack-night`.
 *
 * Both options mean the same thing — the slug of a CMS event — so they suggest
 * from the same directory rather than each growing their own copy.
 *
 * Gated like the commands themselves. Autocomplete is offered to anyone who can
 * see the command, and the CMS's event list is not public: an unpublished event
 * is a plan, and a plan should not leak through a picker to someone who could
 * not act on it anyway. A non-organizer gets an empty list, not an error.
 */

import { UserRole, roleAtLeast } from "@repo/shared/discord";
import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { AutocompleteInteraction } from "discord.js";

import { describeEvent } from "../integrations/event-directory.ts";
import type { EventDirectory } from "../integrations/event-directory.ts";
import { roleOf } from "../utils/roles.ts";

/** The option this fills. Both commands name it the same thing on purpose. */
export const EVENT_OPTION = "event";

export function eventAutocomplete(directory: EventDirectory) {
  return async (interaction: AutocompleteInteraction): Promise<Result<void, Transient>> =>
    Result.tryPromise({
      try: async () => {
        const focused = interaction.options.getFocused(true);
        if (
          focused.name !== EVENT_OPTION ||
          !roleAtLeast(roleOf(interaction), UserRole.Organizer)
        ) {
          await interaction.respond([]);
          return undefined;
        }

        const suggestions = await directory.suggest(focused.value);
        await interaction.respond(
          suggestions.map((event) => ({ name: describeEvent(event), value: event.slug })),
        );
        return undefined;
      },
      catch: (cause) =>
        new Transient({ operation: "suggest CMS events", detail: messageOf(cause) }),
    });
}
