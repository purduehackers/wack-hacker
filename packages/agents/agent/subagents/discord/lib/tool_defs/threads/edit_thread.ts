import { Routes, type RESTPatchAPIChannelJSONBody } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import {
  autoArchiveDuration,
  AUTO_ARCHIVE_DURATIONS,
  discordSnowflakeSchema,
  slowmode,
} from "../../constants.ts";
import { guildChannel, summarizeThread, type ThreadResult } from "../../projections.ts";

export const edit_thread = defineTool({
  access: { risk: "write" },
  description:
    "Edit a thread's settings including name, archived/locked state, auto-archive duration, slowmode, and invitability.",
  input: z.strictObject({
    thread_id: discordSnowflakeSchema,
    name: z.string().trim().min(1).max(100).optional(),
    archived: z.boolean().optional(),
    locked: z.boolean().optional(),
    auto_archive_duration: autoArchiveDuration.optional(),
    slowmode: slowmode.optional(),
    invitable: z.boolean().optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.thread_id);
    return summarizeThread(
      discordObject<ThreadResult>(
        await rest.patch(Routes.channel(input.thread_id), {
          body: compact<RESTPatchAPIChannelJSONBody>({
            name: input.name,
            archived: input.archived,
            locked: input.locked,
            auto_archive_duration:
              input.auto_archive_duration === undefined
                ? undefined
                : AUTO_ARCHIVE_DURATIONS[input.auto_archive_duration],
            rate_limit_per_user: input.slowmode,
            invitable: input.invitable,
          }),
        }),
        "edit channel thread",
      ),
    );
  },
});
