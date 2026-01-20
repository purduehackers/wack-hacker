import { Schema } from "effect";

/**
 * Base error for Code Mode feature.
 * Used for general errors in the handler orchestration.
 */
export class CodeModeError extends Schema.TaggedError<CodeModeError>("CodeModeError")(
    "CodeModeError",
    {
        cause: Schema.optional(Schema.Defect),
        message: Schema.optional(Schema.String),
    },
) {}

/**
 * Error during intent classification.
 * Thrown when the classifier LLM call fails.
 */
export class ClassifierError extends Schema.TaggedError<ClassifierError>("ClassifierError")(
    "ClassifierError",
    {
        cause: Schema.optional(Schema.Defect),
    },
) {}

/**
 * Error during code generation.
 * Thrown when Claude Opus fails to generate code.
 */
export class CodeGenerationError extends Schema.TaggedError<CodeGenerationError>(
    "CodeGenerationError",
)("CodeGenerationError", {
    cause: Schema.optional(Schema.Defect),
}) {}

/**
 * Error during code execution in the Bun Worker.
 * Thrown when the worker fails to start or crashes.
 */
export class CodeExecutionError extends Schema.TaggedError<CodeExecutionError>(
    "CodeExecutionError",
)("CodeExecutionError", {
    cause: Schema.optional(Schema.Defect),
}) {}
