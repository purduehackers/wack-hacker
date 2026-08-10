/**
 * Skill documents are imported as text.
 *
 * `with { type: "text" }` tells Bun and rolldown what to do at runtime and at
 * build; this tells the type checker. Kept outside `agent/` because Eve rejects
 * anything under a subagent's `lib/` that is not an authored module.
 */
declare module "*.md" {
  const text: string;
  export default text;
}
