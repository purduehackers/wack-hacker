import { describe, expect, test } from "bun:test";

import { UserRole } from "@repo/shared/discord";

import {
  CapabilityKind,
  Confirmation,
  PolicySource,
  RiskLevel,
  decideCapability,
  type CapabilityDescriptor,
  type PolicyPrincipal,
} from "./index.ts";

const publicPrincipal: PolicyPrincipal = {
  userId: "10000000000000000",
  role: UserRole.Public,
  source: PolicySource.Chat,
};

function decision(
  risk: CapabilityDescriptor["risk"],
  minRole: CapabilityDescriptor["minRole"],
  confirmation?: CapabilityDescriptor["confirmation"],
) {
  const result = decideCapability(publicPrincipal, {
    kind: CapabilityKind.Tool,
    name: `test-${risk}`,
    minRole,
    risk,
    ...(confirmation === undefined ? {} : { confirmation }),
  });
  if (result.status === "error") throw result.error;
  return result.value;
}

describe("Verdex capability defaults", () => {
  test("read defaults to public with no approval", () => {
    expect(decision(RiskLevel.Read, UserRole.Public)).toEqual({
      discover: true,
      execute: true,
      approve: Confirmation.None,
    });
  });

  test("write defaults to organizer with no approval", () => {
    expect(decision(RiskLevel.Write, UserRole.Organizer)).toEqual({
      discover: false,
      execute: false,
      approve: "deny",
      denial: "role",
    });
    expect(
      decideCapability(
        { ...publicPrincipal, role: UserRole.Organizer },
        {
          kind: CapabilityKind.Tool,
          name: "test-write",
          minRole: UserRole.Organizer,
          risk: RiskLevel.Write,
        },
      ),
    ).toMatchObject({ status: "ok", value: { approve: Confirmation.None } });
  });

  test("destructive defaults to self approval", () => {
    const result = decideCapability(
      { ...publicPrincipal, role: UserRole.Organizer },
      {
        kind: CapabilityKind.Tool,
        name: "test-destructive",
        minRole: UserRole.Organizer,
        risk: RiskLevel.Destructive,
      },
    );
    expect(result).toMatchObject({ status: "ok", value: { approve: Confirmation.Self } });
  });
});

describe("Verdex execution constraints", () => {
  test("scheduled execution denies an explicit second-party confirmation", () => {
    const result = decideCapability(
      { ...publicPrincipal, role: UserRole.Organizer, source: PolicySource.Scheduled },
      {
        kind: CapabilityKind.Tool,
        name: "test-scheduled-second-party",
        minRole: UserRole.Organizer,
        risk: RiskLevel.Destructive,
        confirmation: Confirmation.SecondParty,
      },
    );
    expect(result).toMatchObject({
      status: "ok",
      value: { execute: false, approve: "deny", denial: "confirmation" },
    });
  });

  test("scheduled execution denies the destructive self-confirmation default", () => {
    const result = decideCapability(
      { ...publicPrincipal, role: UserRole.Organizer, source: PolicySource.Scheduled },
      {
        kind: CapabilityKind.Tool,
        name: "test-scheduled-self",
        minRole: UserRole.Organizer,
        risk: RiskLevel.Destructive,
      },
    );
    expect(result).toMatchObject({
      status: "ok",
      value: { execute: false, approve: "deny", denial: "confirmation" },
    });
  });

  test("scheduled execution allows tools with no effective confirmation", () => {
    const result = decideCapability(
      { ...publicPrincipal, role: UserRole.Organizer, source: PolicySource.Scheduled },
      {
        kind: CapabilityKind.Tool,
        name: "test-scheduled-unconfirmed",
        minRole: UserRole.Organizer,
        risk: RiskLevel.Write,
        confirmation: Confirmation.None,
      },
    );
    expect(result).toMatchObject({
      status: "ok",
      value: { execute: true, approve: Confirmation.None },
    });
  });

  test("public budget exhaustion denies execution without increasing discovery", () => {
    const result = decideCapability(
      publicPrincipal,
      {
        kind: CapabilityKind.Tool,
        name: "test-budget",
        minRole: UserRole.Public,
        risk: RiskLevel.Read,
      },
      { budget: { used: 10, limit: 10 } },
    );
    expect(result).toMatchObject({
      status: "ok",
      value: { discover: true, execute: false, approve: "deny", denial: "budget" },
    });
  });
});
