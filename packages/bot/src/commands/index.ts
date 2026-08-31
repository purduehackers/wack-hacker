/**
 * The command registry.
 *
 * Explicit rather than filesystem-discovered. The prior implementation discovered commands
 * by scanning barrel re-exports for anything shaped like a `SlashCommand`, which
 * meant a forgotten re-export silently unregistered a command. A literal list
 * is one line longer and cannot do that.
 *
 * Dependencies are passed in rather than read from module-level singletons, so
 * construction failures surface at one call site during startup rather than the
 * first time someone runs the command.
 */

import type { UpstreamError } from "@repo/shared/errors";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";

import type { SlashCommand } from "../framework/commands.ts";
import { createCmsClient } from "../integrations/cms.ts";
import { createDashboardWriter } from "../integrations/dashboard.ts";
import { createImageDropStore } from "../integrations/image-drop.ts";
import { hackNightCommand } from "./hack-night.ts";
import { imageDropCommand } from "./image-drop.ts";
import { ping } from "./ping.ts";
import { privacyCommand } from "./privacy.ts";

export interface CommandDeps {
  readonly redis: RedisClient;
  readonly vercelToken: string;
  readonly dashboardGlobalConfig: string;
  readonly cmsApiKey: string;
}

/**
 * Builds every command, or fails if a dependency cannot be constructed.
 *
 * The dashboard writer parses a Global Config connection string, which can be
 * malformed. Surfacing that here means the process refuses to start rather than
 * failing the first time an organizer runs `/hack-night` mid-event.
 */
export function buildCommands(deps: CommandDeps): Result<readonly SlashCommand[], UpstreamError> {
  const dashboard = createDashboardWriter({
    vercelToken: deps.vercelToken,
    connectionString: deps.dashboardGlobalConfig,
  });
  if (Result.isError(dashboard)) return dashboard;

  const cms = createCmsClient({ apiKey: deps.cmsApiKey });
  const drops = createImageDropStore(deps.redis);

  return Result.ok([
    ping,
    privacyCommand(deps.redis),
    hackNightCommand({ dashboard: dashboard.value, cms, drops }),
    imageDropCommand({ cms, drops }),
  ]);
}
