/**
 * @fileoverview Runtime vocabulary for the capability policy. This module is a
 * leaf that imports only the shared db enums. That keeps the `types.ts`
 * re-export free of cycles through the policy engine or its callers.
 */

import { ConfirmMode } from "@repo/shared/db/enums";

/** The three shapes of model-visible capability the policy engine gates. */
export const CapabilityKind = {
  Subagent: "subagent",
  Tool: "tool",
  Skill: "skill",
} as const;
export type CapabilityKind = (typeof CapabilityKind)[keyof typeof CapabilityKind];

/** Policy-local name for the db ConfirmMode vocabulary. */
export const Confirmation = ConfirmMode;
export type Confirmation = ConfirmMode;
