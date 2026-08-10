/**
 * The agent's own Discord REST identity.
 *
 * Discord operations are ordinary provider calls, exactly like Linear or Notion:
 * this subagent talks to Discord's API directly rather than asking the bot to do
 * it for us. What stays on the bot is *paint* — the messages the renderer writes
 * to present the agent's own replies — because those share rate-limit buckets
 * with the gateway client and need a single writer for nonce and visible-commit
 * convergence.
 *
 * Missing configuration is reported by the runtime's `configurationError`, the
 * same way every other integration declines when its credential is absent, so
 * tool discovery stays a function of role policy rather than credential
 * presence.
 */

import { REST } from "@discordjs/rest";
import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

import { env } from "../../../env.ts";

/**
 * A type parameter restated property by property.
 *
 * Used as a self-constraint, it requires a generic to be a declared shape
 * without naming the bare `object` keyword, which erases every property of
 * whatever it is applied to. `Shaped<T>` is `T`, so nothing about the caller's
 * type is lost or widened on the way through.
 */
type Shaped<T> = { [K in keyof T]: T[K] };

/**
 * A decoded Discord v10 payload: an object that is neither `null` nor an array.
 *
 * `z.object({})` accepts exactly that set — `null`, every primitive, arrays and
 * functions all fail it, while `Date`, class instances and null-prototype
 * objects pass — so it is a drop-in for the `typeof` test it replaces. The
 * empty shape makes it O(1) and non-recursive, so a cyclic body is answered
 * rather than walked.
 */
const jsonObjectSchema = z.object({});

function isJsonObject(value: unknown): value is NonNullable<unknown> {
  return jsonObjectSchema.safeParse(value).success;
}

let cached: REST | undefined;

export function discordRest(): REST {
  cached ??= new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN ?? "missing-discord-token");
  return cached;
}

export function malformedDiscordResponse(endpoint: string): UpstreamError {
  return new UpstreamError({
    service: "Discord",
    status: 502,
    detail: `${endpoint} returned a malformed response`,
  });
}

/**
 * Drops undefined-valued properties, so a field the caller left unset stays
 * absent from the request body instead of becoming a present `undefined` key.
 * Shared by every operations module: the pruning rule is a property of Discord's
 * wire format, not of any one endpoint family.
 *
 * The copy is made by spread and pruned in place because that preserves the
 * declared shape `T` on its own. Rebuilding it with `Object.fromEntries` erases
 * the key identity and forces the caller to assert the result back to `T`.
 */
export function compact<T extends Shaped<T>>(value: T): T {
  const pruned = { ...value };
  const entries: readonly (readonly [string, unknown])[] = Object.entries(pruned);
  for (const [key, entry] of entries) {
    if (entry === undefined) Reflect.deleteProperty(pruned, key);
  }
  return pruned;
}

/** Narrows an unknown REST body to the endpoint's exported v10 result. */
export function discordObject<T extends Shaped<T>>(value: unknown, endpoint: string): T {
  if (!isJsonObject(value)) {
    throw malformedDiscordResponse(endpoint);
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- REST returns unknown; T is the endpoint's exported v10 result.
  return value as T;
}

/**
 * The element constraint is carried by `isJsonObject` rather than by the type
 * parameter: an element type spelled here would have to be written over
 * `T[number]`, which collapses the unions these v10 result types are built from.
 * Every entry is still checked, and an array of anything but objects still
 * throws.
 */
export function discordArray<T extends readonly unknown[]>(value: unknown, endpoint: string): T {
  if (!Array.isArray(value) || value.some((entry) => !isJsonObject(entry))) {
    throw malformedDiscordResponse(endpoint);
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- REST returns unknown; T is the endpoint's exported v10 result.
  return value as unknown as T;
}
