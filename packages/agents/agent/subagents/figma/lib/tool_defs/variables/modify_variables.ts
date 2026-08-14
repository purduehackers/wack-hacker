import type { PostVariablesRequestBody, PostVariablesResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey } from "../../constants.ts";

/**
 * The mutation grammar Figma's variables endpoint speaks.
 *
 * One POST carries collection, mode and variable changes together, each entry
 * tagged with an action. The generated request types are wide unions, so each
 * schema pins itself to them with `satisfies`. The model then gets a schema
 * rejection naming the supported fields rather than a 400 from Figma.
 */

type VariableCollectionChange = NonNullable<
  PostVariablesRequestBody["variableCollections"]
>[number];
type VariableModeChange = NonNullable<PostVariablesRequestBody["variableModes"]>[number];
type VariableChange = NonNullable<PostVariablesRequestBody["variables"]>[number];
type VariableCreate = Extract<VariableChange, { readonly action: "CREATE" }>;
type VariableScope = NonNullable<VariableCreate["scopes"]>[number];
type VariableCodeSyntax = NonNullable<VariableCreate["codeSyntax"]>;

const variableCollectionChangeSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("CREATE"),
    id: z.string().exactOptional(),
    name: z.string(),
    initialModeId: z.string().exactOptional(),
    hiddenFromPublishing: z.boolean().exactOptional(),
    parentVariableCollectionId: z.string().exactOptional(),
    initialModeIdToParentModeIdMapping: z.record(z.string(), z.string()).exactOptional(),
  }),
  z.strictObject({
    action: z.literal("UPDATE"),
    id: z.string(),
    name: z.string().exactOptional(),
    hiddenFromPublishing: z.boolean().exactOptional(),
  }),
  z.strictObject({
    action: z.literal("DELETE"),
    id: z.string(),
  }),
]) satisfies z.ZodType<VariableCollectionChange>;

const variableModeChangeSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("CREATE"),
    id: z.string().exactOptional(),
    name: z.string(),
    variableCollectionId: z.string(),
  }),
  z.strictObject({
    action: z.literal("UPDATE"),
    id: z.string(),
    name: z.string().exactOptional(),
    variableCollectionId: z.string(),
  }),
  z.strictObject({
    action: z.literal("DELETE"),
    id: z.string(),
  }),
]) satisfies z.ZodType<VariableModeChange>;

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
const variableCodeSyntaxSchema = z.strictObject({
  WEB: z.string().exactOptional(),
  ANDROID: z.string().exactOptional(),
  iOS: z.string().exactOptional(),
}) satisfies z.ZodType<VariableCodeSyntax>;

const variableMutableFields = {
  name: z.string().exactOptional(),
  description: z.string().exactOptional(),
  hiddenFromPublishing: z.boolean().exactOptional(),
  scopes: z.array(variableScopeSchema).exactOptional(),
  codeSyntax: variableCodeSyntaxSchema.exactOptional(),
};
const variableChangeSchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...variableMutableFields,
    action: z.literal("CREATE"),
    id: z.string().exactOptional(),
    name: z.string(),
    variableCollectionId: z.string(),
    resolvedType: z.enum(["BOOLEAN", "FLOAT", "STRING", "COLOR"]),
  }),
  z.strictObject({
    ...variableMutableFields,
    action: z.literal("UPDATE"),
    id: z.string(),
  }),
  z.strictObject({
    action: z.literal("DELETE"),
    id: z.string(),
  }),
]) satisfies z.ZodType<VariableChange>;

export const modify_variables = defineTool({
  description:
    'Bulk create, update, or delete variables and variable collections in a Figma file. Each entry specifies an action ("CREATE", "UPDATE", or "DELETE"). Read current variables first before modifying.',
  access: { risk: "destructive" },
  input: z.strictObject({
    file_key: fileKey,
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
      ...(variable_collections !== undefined && { variableCollections: variable_collections }),
      ...(variable_modes !== undefined && { variableModes: variable_modes }),
      ...(variables !== undefined && { variables }),
    };
    return await figma.post<PostVariablesResponse>(`/v1/files/${file_key}/variables`, body);
  },
});
