import { Effect, Schema } from "effect";
import { CodeExecutionError } from "./errors.js";

export class ExecutionSuccess extends Schema.Class<ExecutionSuccess>("ExecutionSuccess")({
    type: Schema.Literal("success"),
    logs: Schema.Array(Schema.String),
    errors: Schema.Array(Schema.String),
    duration_ms: Schema.Number,
}) {}

export class ExecutionError extends Schema.Class<ExecutionError>("ExecutionError")({
    type: Schema.Literal("error"),
    error: Schema.String,
    stack: Schema.optional(Schema.String),
    logs: Schema.Array(Schema.String),
    errors: Schema.Array(Schema.String),
    duration_ms: Schema.Number,
}) {}

export class ExecutionTimeout extends Schema.Class<ExecutionTimeout>("ExecutionTimeout")({
    type: Schema.Literal("timeout"),
    logs: Schema.Array(Schema.String),
    errors: Schema.Array(Schema.String),
    duration_ms: Schema.Number,
}) {}

export type ExecutionResult = ExecutionSuccess | ExecutionError | ExecutionTimeout;

const EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;

export const executeCode = Effect.fn("CodeMode.executeCode")(function* (script: string) {
    const startTime = Date.now();

    yield* Effect.logInfo("starting code execution", {
        script_length: script.length,
        script_lines: script.split("\n").length,
        timeout_ms: EXECUTION_TIMEOUT_MS,
    });

    const result = yield* Effect.tryPromise({
        try: () =>
            new Promise<ExecutionResult>((resolve) => {
                const blob = new Blob([script], { type: "application/typescript" });
                const blobUrl = URL.createObjectURL(blob);

                let worker: Worker;
                try {
                    worker = new Worker(blobUrl);
                } catch (error: unknown) {
                    URL.revokeObjectURL(blobUrl);
                    const err = error as Error;
                    resolve({
                        type: "error",
                        error: `Failed to create worker: ${err?.message || String(error)}`,
                        stack: err?.stack,
                        logs: [],
                        errors: [],
                        duration_ms: Date.now() - startTime,
                    });
                    return;
                }

                const timeoutId = setTimeout(() => {
                    worker.terminate();
                    URL.revokeObjectURL(blobUrl);
                    resolve({
                        type: "timeout",
                        logs: [],
                        errors: [],
                        duration_ms: Date.now() - startTime,
                    });
                }, EXECUTION_TIMEOUT_MS);

                worker.onmessage = (event: MessageEvent) => {
                    clearTimeout(timeoutId);
                    worker.terminate();
                    URL.revokeObjectURL(blobUrl);
                    resolve(event.data as ExecutionResult);
                };

                worker.onerror = (event: ErrorEvent) => {
                    clearTimeout(timeoutId);
                    worker.terminate();
                    URL.revokeObjectURL(blobUrl);
                    resolve({
                        type: "error",
                        error: event.message || "Unknown worker error",
                        stack: undefined,
                        logs: [],
                        errors: [],
                        duration_ms: Date.now() - startTime,
                    });
                };
            }),
        catch: (error) => new CodeExecutionError({ cause: error }),
    });

    yield* Effect.logInfo("code execution completed", {
        result_type: result.type,
        log_count: result.logs.length,
        error_count: result.errors.length,
        duration_ms: result.duration_ms,
        ...(result.type === "error" && { error: result.error }),
    });

    return result;
});
