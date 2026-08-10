import type { UserRole } from "@repo/shared/discord";

/**
 * A skill's policy and membership, as declared in a domain's `lib/registry.ts`.
 *
 * The prose lives in `skills/<name>.md` and is discovered by Eve directly, so
 * this type deliberately carries no `description`, `criteria`, or
 * `instructions` — the markdown owns those, and duplicating them here is how
 * they drift.
 *
 * `minRole` is documentation plus an invariant rather than a runtime filter.
 * Eve binds static skills at graph-resolution time, before any session exists,
 * so there is nowhere to apply a per-principal check; `check:capabilities`
 * instead requires every tool in an `admin` skill to declare `minRole: "admin"`
 * on its own access descriptor, which is the gate that actually holds.
 */
export interface IntegrationSkill {
  readonly name: string;
  readonly minRole: UserRole;
  readonly tools: readonly string[];
}
