import { isEnumType, isInputObjectType, isListType, isNonNullType } from "graphql";
import type { GraphQLInputObjectType, GraphQLInputType, GraphQLSchema } from "graphql";

/** Deterministic input generator; the reviewed schema is the only provider contract. */
export function renderBufferInputs(schema: GraphQLSchema) {
  const lines = [
    "// Generated from the reviewed Buffer schema. Do not narrow provider inputs.",
    'import { z } from "zod";',
  ];
  const emitted = new Set<string>();
  const active = new Set<string>();
  const objectCode = (type: GraphQLInputObjectType) => {
    if (active.has(type.name))
      throw new Error(`Recursive input ${type.name} requires a reviewed lazy schema`);
    if (!emitted.has(type.name)) {
      active.add(type.name);
      const members = Object.values(type.getFields()).map(
        (field) => `${JSON.stringify(field.name)}: ${fieldCode(field)}`,
      );
      lines.push(`export const ${type.name}Schema = z.strictObject({${members.join(",")}});`);
      active.delete(type.name);
      emitted.add(type.name);
    }
    return `${type.name}Schema`;
  };
  const typeCode = (type: GraphQLInputType): string => {
    if (isNonNullType(type)) return typeCode(type.ofType).replace(/\.nullable\(\)$/u, "");
    if (isListType(type)) return `z.array(${typeCode(type.ofType)}).max(1000).nullable()`;
    if (isEnumType(type))
      return `z.enum(${JSON.stringify(type.getValues().map((value) => value.name))}).nullable()`;
    if (isInputObjectType(type)) return `${objectCode(type)}.nullable()`;
    const scalars: Record<string, string> = {
      Boolean: "z.boolean()",
      Int: "z.int().min(-2147483648).max(2147483647)",
      Float: "z.number()",
    };
    return `${scalars[type.name] ?? "z.string().max(100_000)"}.nullable()`;
  };
  const fieldCode = (field: {
    type: GraphQLInputType;
    description?: string | null | undefined;
    defaultValue?: unknown;
  }) => {
    const optional = !isNonNullType(field.type) || field.defaultValue !== undefined;
    return `${typeCode(field.type)}${optional ? ".optional()" : ""}${field.description ? `.describe(${JSON.stringify(field.description)})` : ""}`;
  };
  for (const root of [schema.getQueryType(), schema.getMutationType()]) {
    for (const field of Object.values(root?.getFields() ?? {})) {
      const parameters = field.args.map((arg) => `${JSON.stringify(arg.name)}: ${fieldCode(arg)}`);
      lines.push(
        `export const ${field.name}Arguments = z.strictObject({${parameters.join(",")}});`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function bufferManifest(schema: GraphQLSchema) {
  return [schema.getQueryType(), schema.getMutationType()].flatMap((root, index) =>
    Object.values(root?.getFields() ?? {}).map((field) => ({
      operation: field.name,
      kind: index === 0 ? "query" : "mutation",
      tool: field.name.replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`),
      minRole: field.name.startsWith("delete") ? "admin" : "organizer",
      risk: field.name.startsWith("delete") ? "destructive" : index === 0 ? "read" : "write",
      arguments: field.args.map((arg) => ({ name: arg.name, type: String(arg.type) })),
    })),
  );
}
