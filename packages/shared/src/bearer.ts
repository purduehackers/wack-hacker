/**
 * Shared-secret authentication for the two internal routes.
 *
 * The bot presents a bearer to the agent; the agent presents a different one
 * back on the park callback. Both directions compare a secret, and both live
 * here so there is one implementation to get right.
 *
 * The comparison is constant-time. `===` on strings returns as soon as it finds
 * a differing byte, so its running time leaks how long a shared prefix an
 * attacker has guessed — enough, over many requests, to recover a secret one
 * character at a time. Length is compared first and non-constant-time, which is
 * fine: the length of these secrets is not the part worth protecting, and the
 * alternative is indexing past the end of a string.
 */

/** Extracts the credential from an `Authorization: Bearer <token>` header. */
function credentialOf(header: string | undefined): string {
  if (header === undefined) return "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

/** True when `presented` equals `expected`, in time independent of the content. */
function secretMatches(presented: string, expected: string): boolean {
  // An unset expected secret must never authenticate anyone. Without this an
  // empty header would match an empty configured value.
  if (expected === "" || presented.length !== expected.length) return false;

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= presented.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * True when the request carries the expected bearer.
 *
 * Accepts `undefined` because that is what a missing header looks like on both
 * runtimes in play — `Headers.get` reports absence as `null`, so call sites pass
 * `header ?? undefined`.
 */
export function bearerMatches(header: string | undefined, expected: string): boolean {
  return secretMatches(credentialOf(header), expected);
}
