import { DefaultSandbox, defineSandbox } from "eve/sandbox";

import { env } from "./env.ts";
import { DurableBashSandbox } from "./lib/sandbox/environment.ts";

// Saved state bypasses this selector. Eve rejects provider mismatches: changing
// this flag requires deployment routing/draining, not an in-place migration.
export const environment = env.DURABLE_BASH_ENABLED
  ? DurableBashSandbox.environment()
  : DefaultSandbox.environment();

export default defineSandbox(() => environment.open());
