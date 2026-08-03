/**
 * Shared test fixtures.
 *
 * discord.js types are enormous — `Client` and `Interaction` each pull in
 * hundreds of members — and a test that only reads two fields should not have to
 * implement all of them. `asDouble` is the single sanctioned place a focused
 * double adopts one of those types, so the assertion is justified once here
 * rather than waived at every call site.
 *
 * This deliberately does *not* weaken the rules for production code: nothing
 * outside a test imports it.
 */

// oxlint-disable-next-line typescript/consistent-type-assertions -- the one sanctioned place a test double adopts a real type
export const asDouble = <T>(value: object): T => value as unknown as T;
