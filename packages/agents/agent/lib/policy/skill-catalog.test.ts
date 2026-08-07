import { describe, expect, test } from "bun:test";

import { UserRole } from "@repo/shared/discord";
import type { SessionAuthContext } from "eve/context";

import { resolveIntegrationSkills, type IntegrationSkillDefinition } from "./skill-catalog.ts";

const definitions = [
  {
    name: "read",
    description: "Read records.",
    criteria: "Use for record lookup.",
    minRole: UserRole.Public,
    tools: ["read_record"],
    instructions: "READ_INSTRUCTIONS",
  },
  {
    name: "write",
    description: "Write records.",
    criteria: "Use for explicit record changes.",
    minRole: UserRole.Organizer,
    tools: ["write_record"],
    instructions: "WRITE_INSTRUCTIONS",
  },
] as const satisfies readonly IntegrationSkillDefinition[];

function auth(role: UserRole): SessionAuthContext {
  return {
    authenticator: "native-skill-test",
    principalType: "user",
    principalId: "10000000000000000",
    attributes: { role },
  };
}

describe("Eve-native integration skill catalog", () => {
  test("fails closed and resolves only skills permitted by the current role", () => {
    // oxlint-disable-next-line unicorn/no-null -- Eve models absent current auth as null
    expect(resolveIntegrationSkills(null, definitions)).toEqual({});
    expect(Object.keys(resolveIntegrationSkills(auth(UserRole.Public), definitions))).toEqual([
      "read",
    ]);
    expect(Object.keys(resolveIntegrationSkills(auth(UserRole.Organizer), definitions))).toEqual([
      "read",
      "write",
    ]);
  });

  test("preserves instructions and advertises the existing use criterion", () => {
    const skills = resolveIntegrationSkills(auth(UserRole.Organizer), definitions);
    expect(skills.read?.markdown).toBe("READ_INSTRUCTIONS");
    expect(skills.read?.description).toBe("Read records. Use for record lookup.");
    expect(skills.read?.metadata).toEqual({
      criteria: "Use for record lookup.",
      minRole: UserRole.Public,
    });
  });
});
