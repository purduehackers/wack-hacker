import { deleteSnippetArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const delete_snippet = defineBufferOperation("deleteSnippet", deleteSnippetArguments);
