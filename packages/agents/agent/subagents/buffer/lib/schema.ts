import {
  buildSchema,
  getNamedType,
  isCompositeType,
  isLeafType,
  isObjectType,
  isUnionType,
  parse,
  validate,
  visit,
} from "graphql";
import type { GraphQLField, GraphQLOutputType } from "graphql";
import { z } from "zod";

import { BUFFER_SCHEMA_SDL } from "./schema-source.ts";

export const bufferSchema = buildSchema(BUFFER_SCHEMA_SDL);

export function operationField(name: string) {
  const query = bufferSchema.getQueryType()?.getFields()[name];
  const mutation = bufferSchema.getMutationType()?.getFields()[name];
  const field = query ?? mutation;
  if (field === undefined) throw new Error(`Unknown Buffer operation: ${name}`);
  return { field, kind: query === undefined ? "mutation" : "query" } as const;
}

/** Select shallow scalars plus connection nodes; callers can request any schema field. */
export function defaultSelection(type: GraphQLOutputType, depth = 0): string {
  const named = getNamedType(type);
  if (isLeafType(named)) return "";
  if (isUnionType(named)) {
    return `__typename ${named
      .getTypes()
      .map((member) => `... on ${member.name} { ${defaultSelection(member, depth)} }`)
      .join(" ")}`;
  }
  if (!isObjectType(named)) return "__typename";
  const candidates = Object.values(named.getFields()).filter((field) =>
    field.args.every((arg) => !String(arg.type).endsWith("!") || arg.defaultValue !== undefined),
  );
  return [
    "__typename",
    ...candidates.flatMap((field) => {
      if (isLeafType(getNamedType(field.type))) return [field.name];
      const connection = ["edges", "node", "pageInfo"].includes(field.name);
      if (depth >= (connection ? 4 : 2)) return [];
      return [`${field.name} { ${defaultSelection(field.type, depth + 1)} }`];
    }),
  ].join(" ");
}

function variablesFor(
  field: GraphQLField<unknown, unknown>,
  variables: Readonly<Record<string, z.output<ReturnType<typeof z.json>>>>,
) {
  const supplied = field.args.filter((arg) => Object.hasOwn(variables, arg.name));
  return {
    declarations: supplied.map((arg) => `$${arg.name}: ${String(arg.type)}`).join(", "),
    arguments: supplied.map((arg) => `${arg.name}: $${arg.name}`).join(", "),
  };
}

export function operationDocument(
  name: string,
  variables: Readonly<Record<string, z.output<ReturnType<typeof z.json>>>>,
  selection?: string,
) {
  const { field, kind } = operationField(name);
  const args = variablesFor(field, variables);
  const declared = args.declarations === "" ? "" : `(${args.declarations})`;
  const supplied = args.arguments === "" ? "" : `(${args.arguments})`;
  const composite = isCompositeType(getNamedType(field.type));
  const defaults = defaultSelection(field.type);
  // Protected default members preserve union errors and ownership information.
  const body = composite
    ? `{ ${selection === undefined ? defaults : `${selection} ${defaults}`} }`
    : "";
  const document = `${kind} WackBuffer${declared} { ${name}${supplied} ${body} }`;
  const ast = parse(document, { maxTokens: 20_000 });
  if (ast.definitions.length !== 1) throw new Error("Expected one Buffer operation");
  const definition = ast.definitions[0];
  if (definition?.kind !== "OperationDefinition" || definition.selectionSet.selections.length !== 1)
    throw new Error("Selection cannot add root operations");
  const root = definition.selectionSet.selections[0];
  if (root?.kind !== "Field" || root.name.value !== name || root.alias !== undefined)
    throw new Error("Selection changed the root operation");
  let depth = 0;
  let count = 0;
  visit(ast, {
    Field: {
      enter() {
        depth += 1;
        count += 1;
        if (depth > 12 || count > 1500)
          throw new Error("Buffer selection exceeds 12 levels or 1500 fields");
      },
      leave() {
        depth -= 1;
      },
    },
  });
  const errors = validate(bufferSchema, ast);
  if (errors.length > 0) throw new Error(errors.map((issue) => issue.message).join("; "));
  return { document, kind };
}
