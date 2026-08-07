import type {
  GetLocalVariablesResponse,
  GetPublishedVariablesResponse,
  PostVariablesRequestBody,
  PostVariablesResponse,
} from "@figma/rest-api-spec";
import { z } from "zod";

import { figma } from "./client.ts";
import { defineTool } from "./define-tool.ts";

type VariableCollectionChange = NonNullable<
  PostVariablesRequestBody["variableCollections"]
>[number];
type VariableModeChange = NonNullable<PostVariablesRequestBody["variableModes"]>[number];
type VariableChange = NonNullable<PostVariablesRequestBody["variables"]>[number];
type VariableCreate = Extract<VariableChange, { readonly action: "CREATE" }>;
type VariableScope = NonNullable<VariableCreate["scopes"]>[number];
type VariableCodeSyntax = NonNullable<VariableCreate["codeSyntax"]>;

const variableCollectionChangeInputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("CREATE"),
    id: z.string().optional(),
    name: z.string(),
    initialModeId: z.string().optional(),
    hiddenFromPublishing: z.boolean().optional(),
    parentVariableCollectionId: z.string().optional(),
    initialModeIdToParentModeIdMapping: z.record(z.string(), z.string()).optional(),
  }),
  z.strictObject({
    action: z.literal("UPDATE"),
    id: z.string(),
    name: z.string().optional(),
    hiddenFromPublishing: z.boolean().optional(),
  }),
  z.strictObject({
    action: z.literal("DELETE"),
    id: z.string(),
  }),
]);
const variableCollectionChangeSchema = variableCollectionChangeInputSchema.transform(
  (change): VariableCollectionChange => {
    if (change.action === "DELETE") return change;
    if (change.action === "UPDATE") {
      return {
        action: change.action,
        id: change.id,
        ...(change.name === undefined ? {} : { name: change.name }),
        ...(change.hiddenFromPublishing === undefined
          ? {}
          : { hiddenFromPublishing: change.hiddenFromPublishing }),
      };
    }
    return {
      action: change.action,
      name: change.name,
      ...(change.id === undefined ? {} : { id: change.id }),
      ...(change.initialModeId === undefined ? {} : { initialModeId: change.initialModeId }),
      ...(change.hiddenFromPublishing === undefined
        ? {}
        : { hiddenFromPublishing: change.hiddenFromPublishing }),
      ...(change.parentVariableCollectionId === undefined
        ? {}
        : { parentVariableCollectionId: change.parentVariableCollectionId }),
      ...(change.initialModeIdToParentModeIdMapping === undefined
        ? {}
        : {
            initialModeIdToParentModeIdMapping: change.initialModeIdToParentModeIdMapping,
          }),
    };
  },
) satisfies z.ZodType<VariableCollectionChange>;

const variableModeChangeInputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("CREATE"),
    id: z.string().optional(),
    name: z.string(),
    variableCollectionId: z.string(),
  }),
  z.strictObject({
    action: z.literal("UPDATE"),
    id: z.string(),
    name: z.string().optional(),
    variableCollectionId: z.string(),
  }),
  z.strictObject({
    action: z.literal("DELETE"),
    id: z.string(),
  }),
]);
const variableModeChangeSchema = variableModeChangeInputSchema.transform(
  (change): VariableModeChange => {
    if (change.action === "DELETE") return change;
    if (change.action === "UPDATE") {
      return {
        action: change.action,
        id: change.id,
        variableCollectionId: change.variableCollectionId,
        ...(change.name === undefined ? {} : { name: change.name }),
      };
    }
    return {
      action: change.action,
      name: change.name,
      variableCollectionId: change.variableCollectionId,
      ...(change.id === undefined ? {} : { id: change.id }),
    };
  },
) satisfies z.ZodType<VariableModeChange>;

const variableScopeSchema = z.enum([
  "ALL_SCOPES",
  "TEXT_CONTENT",
  "CORNER_RADIUS",
  "WIDTH_HEIGHT",
  "GAP",
  "ALL_FILLS",
  "FRAME_FILL",
  "SHAPE_FILL",
  "TEXT_FILL",
  "STROKE_COLOR",
  "STROKE_FLOAT",
  "EFFECT_FLOAT",
  "EFFECT_COLOR",
  "OPACITY",
  "FONT_FAMILY",
  "FONT_STYLE",
  "FONT_WEIGHT",
  "FONT_SIZE",
  "LINE_HEIGHT",
  "LETTER_SPACING",
  "PARAGRAPH_SPACING",
  "PARAGRAPH_INDENT",
  "FONT_VARIATIONS",
]) satisfies z.ZodType<VariableScope>;
const variableCodeSyntaxInputSchema = z.strictObject({
  WEB: z.string().optional(),
  ANDROID: z.string().optional(),
  iOS: z.string().optional(),
});
const variableCodeSyntaxSchema = variableCodeSyntaxInputSchema.transform(
  (syntax): VariableCodeSyntax => ({
    ...(syntax.WEB === undefined ? {} : { WEB: syntax.WEB }),
    ...(syntax.ANDROID === undefined ? {} : { ANDROID: syntax.ANDROID }),
    ...(syntax.iOS === undefined ? {} : { iOS: syntax.iOS }),
  }),
) satisfies z.ZodType<VariableCodeSyntax>;

const variableChangeInputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("CREATE"),
    id: z.string().optional(),
    name: z.string(),
    variableCollectionId: z.string(),
    resolvedType: z.enum(["BOOLEAN", "FLOAT", "STRING", "COLOR"]),
    description: z.string().optional(),
    hiddenFromPublishing: z.boolean().optional(),
    scopes: z.array(variableScopeSchema).optional(),
    codeSyntax: variableCodeSyntaxSchema.optional(),
  }),
  z.strictObject({
    action: z.literal("UPDATE"),
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    hiddenFromPublishing: z.boolean().optional(),
    scopes: z.array(variableScopeSchema).optional(),
    codeSyntax: variableCodeSyntaxSchema.optional(),
  }),
  z.strictObject({
    action: z.literal("DELETE"),
    id: z.string(),
  }),
]);
const variableChangeSchema = variableChangeInputSchema.transform((change): VariableChange => {
  if (change.action === "DELETE") return change;
  const optionalFields = {
    ...(change.name === undefined ? {} : { name: change.name }),
    ...(change.description === undefined ? {} : { description: change.description }),
    ...(change.hiddenFromPublishing === undefined
      ? {}
      : { hiddenFromPublishing: change.hiddenFromPublishing }),
    ...(change.scopes === undefined ? {} : { scopes: change.scopes }),
    ...(change.codeSyntax === undefined ? {} : { codeSyntax: change.codeSyntax }),
  };
  if (change.action === "UPDATE") {
    return { action: change.action, id: change.id, ...optionalFields };
  }
  return {
    action: change.action,
    name: change.name,
    variableCollectionId: change.variableCollectionId,
    resolvedType: change.resolvedType,
    ...(change.id === undefined ? {} : { id: change.id }),
    ...optionalFields,
  };
}) satisfies z.ZodType<VariableChange>;

export const get_local_variables = defineTool({
  name: "get_local_variables",
  domain: "figma",
  description:
    "Get all local variables and variable collections in a Figma file, including unpublished ones. Variables have modes (e.g., Light/Dark) with per-mode values.",
  access: { risk: "read" },
  input: z.object({
    file_key: z.string().describe("The file key"),
  }),
  execute: async ({ file_key }) => {
    const data = await figma.get<GetLocalVariablesResponse>(
      `/v1/files/${file_key}/variables/local`,
    );
    return data.meta;
  },
});

export const get_published_variables = defineTool({
  name: "get_published_variables",
  domain: "figma",
  description:
    "Get published variables and variable collections in a Figma file. Only returns variables that have been published and are visible to consumers.",
  access: { risk: "read" },
  input: z.object({
    file_key: z.string().describe("The file key"),
  }),
  execute: async ({ file_key }) => {
    const data = await figma.get<GetPublishedVariablesResponse>(
      `/v1/files/${file_key}/variables/published`,
    );
    return data.meta;
  },
});

export const modify_variables = defineTool({
  name: "modify_variables",
  domain: "figma",
  description:
    'Bulk create, update, or delete variables and variable collections in a Figma file. Each entry specifies an action ("CREATE", "UPDATE", or "DELETE"). Read current variables first before modifying.',
  access: { risk: "destructive" },
  input: z.object({
    file_key: z.string().describe("The file key"),
    variable_collections: z
      .array(variableCollectionChangeSchema)
      .optional()
      .describe("Variable collection mutations (action + fields)"),
    variable_modes: z
      .array(variableModeChangeSchema)
      .optional()
      .describe("Variable mode mutations (action + fields)"),
    variables: z
      .array(variableChangeSchema)
      .optional()
      .describe("Variable mutations (action + fields)"),
  }),
  execute: async ({ file_key, variable_collections, variable_modes, variables }) => {
    const body: PostVariablesRequestBody = {
      ...(variable_collections === undefined ? {} : { variableCollections: variable_collections }),
      ...(variable_modes === undefined ? {} : { variableModes: variable_modes }),
      ...(variables === undefined ? {} : { variables }),
    };
    return await figma.post<PostVariablesResponse>(`/v1/files/${file_key}/variables`, body);
  },
});
