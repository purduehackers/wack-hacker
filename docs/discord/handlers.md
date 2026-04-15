# Writing handlers

Handlers live under `src/bot/handlers/`, one directory per handler. The file just exports an object built with one of the `defineX` helpers.

## Slash commands

```ts
// src/bot/handlers/commands/ping/index.ts
import { SlashCommandBuilder } from "discord.js";

import { defineCommand } from "@/bot/commands/define";
import { respond } from "@/bot/commands/helpers";

export const ping = defineCommand({
  builder: new SlashCommandBuilder().setName("ping").setDescription("Health check"),
  async execute(ctx) {
    await respond(ctx, "pong");
  },
});
```

`defineCommand({ builder, execute })` returns a `SlashCommand`. The interactions route auto-discovers commands by re-export — anything exported from `src/bot/handlers/commands/index.ts` that has the `SlashCommand` shape ends up in the command map.

`ctx.options` is a flat `Map<string, string | number | boolean>` produced by `parseOptions` so you don't have to walk Discord's nested option tree. `parseSubcommand` is also available if you need it.

The interactions route immediately returns `DeferredChannelMessageWithSource` and runs your `execute` inside `waitUntil`, so reply with `respond(ctx, ...)` (which uses `editReply` under the hood) — don't try to send the initial reply yourself.

After adding a command, run `bun run scripts/register-commands.ts` (or just `bun run build` — it's part of the build) to register it with Discord.

## Message components

```ts
import { defineComponent } from "@/bot/components/define";

export const someButton = defineComponent({
  prefix: "btn",
  async handle({ interaction, discord, customId }) {
    // customId === "btn:<rest>"
  },
});
```

Components are routed by `custom_id` prefix: the interactions route splits the incoming `custom_id` on `:` and looks up a handler whose `prefix` matches the **first segment**. So `prefix` must be a single token — `"btn:some"` would not match because `split(":")[0]` is just `"btn"`.

Component handlers are discovered via `import * as components from "@/bot/components"`. As of writing there is no `bot/handlers/components/` directory and the barrel doesn't re-export any handlers, so you'll need to add your file plus an export wherever you wire it up.

## Events

```ts
// src/bot/handlers/events/auto-thread/index.ts
import { defineEvent } from "@/bot/events/define";

export const autoThread = defineEvent({
  type: "message",
  async handle(packet, ctx) {
    // ...
  },
});
```

`defineEvent` is a discriminated union on `type`: `"message" | "reactionAdd" | "reactionRemove" | "messageDelete" | "messageUpdate" | "voiceStateUpdate" | "threadCreate"`. The `handle` function's first argument is typed to the matching `Packet`, the second is the shared `HandlerContext`.

`src/server/routes/handlers.ts` walks every exported event handler from `@/bot/handlers/events` and seeds the `EventRouter` accordingly. Add a re-export to `src/bot/handlers/events/index.ts` for your new file.

## Crons

```ts
// src/bot/handlers/crons/some-job/index.ts
import { defineCron } from "@/bot/crons/define";

export const someJob = defineCron({
  name: "some-job",
  schedule: "0 9 * * *",
  async handle(discord) {
    // discord is a freshly-constructed @discordjs/core API client
  },
});
```

Crons are reached by hitting `GET /api/crons/:name` with `Authorization: Bearer ${CRON_SECRET}`. The route looks the cron up by `name` and calls `cron.handle(discord)` — the cron's `schedule` field is metadata only, not actually wired to Vercel's scheduler.

To make Vercel actually fire the cron, add `{ path: "/api/crons/<name>", schedule: "..." }` to the `crons` array in `vercel.ts`. As of writing only the gateway cron is registered there.
