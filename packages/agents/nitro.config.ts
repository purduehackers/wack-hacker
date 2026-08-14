/**
 * Teaches the bundler to load `.md` as text.
 *
 * Skill prose lives in `subagents/<domain>/skill_defs/*.md`. Each import uses
 * `with { type: "text" }`. Bun honors that attribute on its own, but the
 * production build goes through nitro's rolldown pass. That pass otherwise
 * tries to parse the markdown as JavaScript and fails with a PARSE_ERROR.
 *
 * Eve does not expose a bundler hook, so this reaches rolldown through nitro's
 * own c12 config discovery, which deep-merges with the config Eve supplies.
 * Nitro does not document that path, but it fails loudly rather than silently.
 * Without this file the build stops at the first `.md` import instead of
 * shipping something subtly wrong.
 */
export default { rolldownConfig: { moduleTypes: { ".md": "text" } } };
