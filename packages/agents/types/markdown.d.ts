/**
 * Ambient module type for skill documents imported as text.
 *
 * `with { type: "text" }` tells Bun and rolldown what to do at runtime and at
 * build. This declaration tells the type checker. Kept outside `agent/`
 * because Eve rejects anything under a subagent's `lib/` that is not an
 * authored module.
 */
declare module "*.md" {
  const text: string;
  export default text;
}
