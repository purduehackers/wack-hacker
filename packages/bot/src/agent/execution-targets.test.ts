import { expect, test } from "bun:test";

import { parseExecutionTargets, originHash, targetForBinding } from "./execution-targets.ts";

const identity = {
  id: "dpl_legacy",
  projectId: "legacy-project",
  runtime: "eve-0.31.3",
  sandbox: "vercel-sandbox-v1",
};
function config(origin = "https://wack-hacker-123456abc-purdue-hackers.vercel.app") {
  return {
    current: identity.id,
    legacy: identity.id,
    targets: [{ identity, origin, enabled: true, capabilities: ["session-affinity-v1"] }],
  };
}

test("rejects mutable aliases, credentials, paths, redirects, missing or disabled selectors", () => {
  for (const origin of [
    "https://wack-hacker.vercel.app",
    "https://bot.example.com",
    "https://user:password@wack-hacker-123456abc-purdue-hackers.vercel.app",
    "https://wack-hacker-123456abc-purdue-hackers.vercel.app/path",
    "https://wack-hacker-123456abc-purdue-hackers.vercel.app/?url=other",
    "http://wack-hacker-123456abc-purdue-hackers.vercel.app",
  ]) {
    expect(() => parseExecutionTargets(JSON.stringify(config(origin)))).toThrow();
  }
  expect(() =>
    parseExecutionTargets(JSON.stringify({ ...config(), current: "unknown" })),
  ).toThrow();
  const disabled = config();
  for (const target of disabled.targets) target.enabled = false;
  expect(() => parseExecutionTargets(JSON.stringify(disabled))).toThrow();
});

test("an existing binding refuses missing, revoked and repointed target identities", () => {
  const parsed = parseExecutionTargets(JSON.stringify(config()));
  const original = parsed.targets[0];
  if (original === undefined) throw new Error("missing fixture target");
  const binding = {
    version: 1 as const,
    generation: crypto.randomUUID(),
    identity: original.identity,
    originHash: originHash(original.origin),
  };
  expect(targetForBinding(parsed, binding)).toEqual(original);
  for (const replacement of [
    { ...original, enabled: false },
    { ...original, origin: "https://wack-hacker-987654abc-purdue-hackers.vercel.app" },
    { ...original, identity: { ...original.identity, runtime: "eve-0.81.1" } },
    { ...original, identity: { ...original.identity, sandbox: "durable-bash-v1" as const } },
    { ...original, capabilities: [] },
  ])
    expect(() => targetForBinding({ ...parsed, targets: [replacement] }, binding)).toThrow();
  expect(() => targetForBinding({ ...parsed, targets: [] }, binding)).toThrow();
});

test("incompatible runtime cohorts cannot share the legacy Workflow project latest", () => {
  const legacy = config().targets[0];
  if (legacy === undefined) throw new Error("legacy target required");
  const candidate = {
    ...legacy,
    identity: { ...legacy.identity, id: "dpl_candidate", runtime: "eve-0.81.1" },
  };
  expect(() =>
    parseExecutionTargets(
      JSON.stringify({
        current: candidate.identity.id,
        legacy: legacy.identity.id,
        targets: [legacy, candidate],
      }),
    ),
  ).toThrow("separate Workflow projects");
  const separate = {
    ...candidate,
    identity: { ...candidate.identity, projectId: "candidate-project" },
  };
  expect(
    parseExecutionTargets(
      JSON.stringify({
        current: separate.identity.id,
        legacy: legacy.identity.id,
        targets: [legacy, separate],
      }),
    ).targets,
  ).toHaveLength(2);
});

test("retained non-selected0.31 deployments also forbid incompatible project latest", () => {
  const legacy = config().targets[0];
  if (legacy === undefined) throw new Error("legacy target required");
  const inactiveSelector = {
    ...legacy,
    identity: { ...legacy.identity, id: "retained-not-selected" },
  };
  const incompatible = {
    ...legacy,
    identity: { ...legacy.identity, id: "other-new-runtime", runtime: "eve-0.81.1" },
  };
  expect(() =>
    parseExecutionTargets(
      JSON.stringify({
        current: legacy.identity.id,
        legacy: legacy.identity.id,
        targets: [legacy, inactiveSelector, incompatible],
      }),
    ),
  ).toThrow("separate Workflow projects");
});
