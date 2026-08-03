/**
 * The command registry.
 *
 * Explicit rather than filesystem-discovered. The legacy app discovered commands
 * by scanning barrel re-exports for anything shaped like a `SlashCommand`, which
 * meant a forgotten re-export silently unregistered a command. A literal list
 * is one line longer and cannot do that.
 */

import type { SlashCommand } from "./define.ts";
import { ping } from "./ping.ts";

export const COMMANDS: readonly SlashCommand[] = [ping];

export { ping };
export type { SlashCommand } from "./define.ts";
