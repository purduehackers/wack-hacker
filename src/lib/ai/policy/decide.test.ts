import { describe, expect, it } from "vitest";

import type { AccessSpec, BudgetState, PolicyDecision } from "./types.ts";

import { UserRole } from "../constants.ts";
import { BUDGET_DENY_MESSAGE } from "./constants.ts";
import { decide, roleAtLeast } from "./decide.ts";

const SUBJECTS = {
  public: { userId: "u-pub", role: UserRole.Public },
  organizer: { userId: "u-org", role: UserRole.Organizer },
  admin: { userId: "u-adm", role: UserRole.Admin },
} as const;

function run(
  role: keyof typeof SUBJECTS,
  access: AccessSpec,
  budgetState: BudgetState | null = null,
): PolicyDecision {
  return decide(
    SUBJECTS[role],
    { name: "test_tool", access },
    { channelId: "ch-1", source: "chat", budgetState },
  );
}

describe("decide — role × risk defaults", () => {
  const matrix: Array<[keyof typeof SUBJECTS, AccessSpec["risk"], PolicyDecision["kind"]]> = [
    ["public", "read", "allow"],
    ["public", "write", "deny"],
    ["public", "destructive", "deny"],
    ["organizer", "read", "allow"],
    ["organizer", "write", "allow"],
    ["organizer", "destructive", "confirm"],
    ["admin", "read", "allow"],
    ["admin", "write", "allow"],
    ["admin", "destructive", "confirm"],
  ];

  it.each(matrix)("%s × %s → %s", (role, risk, kind) => {
    expect(run(role, { risk }).kind).toBe(kind);
  });

  it("role denials carry code 'role' and name the required tier", () => {
    const d = run("public", { risk: "write" });
    expect(d).toMatchObject({ kind: "deny", code: "role" });
    if (d.kind === "deny") expect(d.message).toContain("organizer");
  });
});

describe("decide — per-tool overrides", () => {
  it("minRole 'admin' strips organizers but allows admins", () => {
    expect(run("organizer", { risk: "read", minRole: "admin" }).kind).toBe("deny");
    expect(run("admin", { risk: "read", minRole: "admin" }).kind).toBe("allow");
  });

  it("minRole 'public' opens a write tool to public users", () => {
    expect(run("public", { risk: "write", minRole: "public" }).kind).toBe("allow");
  });

  it("confirm 'second-party' maps to an approve decision", () => {
    expect(run("organizer", { risk: "destructive", confirm: "second-party" })).toEqual({
      kind: "approve",
      approvers: "second-party",
    });
  });

  it("confirm 'self' on a write tool maps to confirm", () => {
    expect(run("organizer", { risk: "write", confirm: "self" }).kind).toBe("confirm");
  });

  it("confirm 'none' overrides the destructive default", () => {
    expect(run("organizer", { risk: "destructive", confirm: "none" }).kind).toBe("allow");
  });
});

describe("decide — budget dimension", () => {
  const over: BudgetState = { used: 250_000, limit: 250_000 };
  const under: BudgetState = { used: 10, limit: 250_000 };

  it("denies a public user over budget with the friendly message", () => {
    const d = run("public", { risk: "read" }, over);
    expect(d).toEqual({ kind: "deny", code: "budget", message: BUDGET_DENY_MESSAGE });
  });

  it("allows a public user under budget", () => {
    expect(run("public", { risk: "read" }, under).kind).toBe("allow");
  });

  it("exempts organizers and admins from the budget", () => {
    expect(run("organizer", { risk: "read" }, over).kind).toBe("allow");
    expect(run("admin", { risk: "read" }, over).kind).toBe("allow");
  });

  it("skips the dimension entirely when budget state is unknown", () => {
    expect(run("public", { risk: "read" }, null).kind).toBe("allow");
  });

  it("role denial wins over budget denial (tool stays invisible)", () => {
    expect(run("public", { risk: "write" }, over)).toMatchObject({ kind: "deny", code: "role" });
  });
});

describe("roleAtLeast", () => {
  it("orders public < organizer < admin", () => {
    expect(roleAtLeast(UserRole.Public, UserRole.Public)).toBe(true);
    expect(roleAtLeast(UserRole.Public, UserRole.Organizer)).toBe(false);
    expect(roleAtLeast(UserRole.Organizer, UserRole.Organizer)).toBe(true);
    expect(roleAtLeast(UserRole.Organizer, UserRole.Admin)).toBe(false);
    expect(roleAtLeast(UserRole.Admin, UserRole.Organizer)).toBe(true);
    expect(roleAtLeast(UserRole.Admin, UserRole.Admin)).toBe(true);
  });
});
