import { createHash } from "node:crypto";

import { executionIdentitySchema, type ExecutionBinding } from "@repo/shared/conversations";
import { jsonCodec } from "@repo/shared/json";
import { z } from "zod";

const originSchema = z
  .url({ protocol: /^https?$/u, normalize: true, abort: true })
  .refine((value) => {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    // Vercel deployment URLs contain their immutable random deployment hash.
    const deployment = /^.+-[a-z0-9]{9}-.+\.vercel\.app$/u.test(url.hostname);
    return (
      (local || (url.protocol === "https:" && deployment)) &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  }, "expected an immutable Vercel deployment origin or local test server");

export const executionTargetSchema = z.strictObject({
  identity: executionIdentitySchema,
  origin: originSchema,
  enabled: z.boolean(),
  capabilities: z.array(z.enum(["session-affinity-v1", "exact-turn-cancel-v1"])),
});

const targetsSchema = z
  .strictObject({
    current: z.string().min(1),
    legacy: z.string().min(1),
    targets: z.array(executionTargetSchema).min(1).max(32),
  })
  .superRefine((config, ctx) => {
    const ids = new Set(config.targets.map(({ identity }) => identity.id));
    if (ids.size !== config.targets.length) {
      ctx.addIssue({ code: "custom", path: ["targets"], message: "deployment IDs must be unique" });
    }
    for (const target of config.targets) {
      if (!target.enabled || target.identity.runtime !== "eve-0.31.3") continue;
      const mixed = config.targets.some(
        (other) =>
          other.enabled &&
          other.identity.projectId === target.identity.projectId &&
          other.identity.runtime !== target.identity.runtime,
      );
      if (mixed)
        ctx.addIssue({
          code: "custom",
          path: ["targets"],
          message:
            "Eve0.31 dispatches child turns to project latest; incompatible runtimes require separate Workflow projects",
        });
    }
    for (const name of ["current", "legacy"] as const) {
      const target = config.targets.find(({ identity }) => identity.id === config[name]);
      if (!target?.enabled || !target.capabilities.includes("session-affinity-v1")) {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: "must name an enabled affinity-capable target",
        });
      }
    }
  });

export type ExecutionTarget = z.output<typeof executionTargetSchema>;
export type ExecutionTargets = z.output<typeof targetsSchema>;

export function parseExecutionTargets(value: string): ExecutionTargets {
  return jsonCodec(targetsSchema).parse(value);
}

export function originHash(origin: string): string {
  return createHash("sha256").update(new URL(origin).origin).digest("hex");
}

export function targetForBinding(
  config: ExecutionTargets,
  binding: ExecutionBinding,
): ExecutionTarget {
  const target = config.targets.find(({ identity }) => identity.id === binding.identity.id);
  if (
    !target?.enabled ||
    target.identity.runtime !== binding.identity.runtime ||
    target.identity.projectId !== binding.identity.projectId ||
    target.identity.sandbox !== binding.identity.sandbox ||
    originHash(target.origin) !== binding.originHash ||
    !target.capabilities.includes("session-affinity-v1")
  ) {
    throw new Error(
      "The task's execution deployment is unavailable or changed; restore its configured target.",
    );
  }
  return target;
}
