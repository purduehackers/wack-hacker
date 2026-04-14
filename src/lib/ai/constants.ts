/**
 * `UserRole` is defined as an `as const` object instead of a TypeScript enum
 * because this module is pulled into workflow step bundles, which Node.js
 * executes in strip-only type mode — and strip-only mode does not support
 * enum syntax. The derived type alias lives here (rather than in `types.ts`)
 * so consumers can import the value and type together under one name.
 */
export const UserRole = {
  Public: "public",
  Organizer: "organizer",
  Admin: "admin",
} as const;

// eslint-disable-next-line @factory/constants-file-organization, @factory/types-file-organization
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
