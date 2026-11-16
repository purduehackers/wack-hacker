import { z } from "zod";

export const bufferResultSchema = z.strictObject({
  ok: z.boolean(),
  operation: z.string(),
  data: z.json(),
  errors: z.array(z.string()),
  rateLimit: z.string().optional(),
});
export type BufferResult = z.output<typeof bufferResultSchema>;

export function mutationErrors(value: z.JSONType): string[] {
  if (Array.isArray(value)) return value.flatMap(mutationErrors);
  const object = z.record(z.string(), z.json()).safeParse(value);
  if (!object.success) return [];
  const name = z.string().safeParse(object.data.__typename).data ?? "";
  const message = z.string().safeParse(object.data.message).data;
  const own = /(?:Error|Failure)$/u.test(name) ? [message ?? name] : [];
  return [...own, ...Object.values(object.data).flatMap(mutationErrors)];
}

export function assertOrganizationScope(
  organizations: readonly string[],
  allowed: readonly string[],
) {
  if (organizations.length === 0 || organizations.some((id) => !allowed.includes(id)))
    throw new Error(
      "Buffer key has membership access outside BUFFER_ORGANIZATION_IDS; configure all intended organizations or use a scoped account",
    );
}
