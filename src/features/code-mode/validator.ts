import { Effect } from "effect";
import * as ts from "typescript";

/**
 * Type stub declarations for Discord.js context.
 * These allow the TypeScript compiler to parse the code without errors
 * for the pre-defined variables (client, guild, channel, etc.).
 *
 * We're only doing syntax checking, not full type checking,
 * so these minimal stubs are sufficient.
 */
const DISCORD_TYPE_STUBS = `
declare const client: any;
declare const guild: any;
declare const channel: any;
declare const message: any;
declare const author: any;
declare function log(...args: any[]): void;
declare function sleep(ms: number): Promise<void>;
`;

/**
 * Validation result from the TypeScript syntax checker.
 */
export interface ValidationResult {
    /** Whether the code passed syntax validation */
    valid: boolean;
    /** Array of syntax errors found (empty if valid) */
    errors: Array<{
        /** Line number in the user's code (1-indexed) */
        line: number;
        /** Character position in the line (1-indexed) */
        character: number;
        /** Human-readable error message */
        message: string;
    }>;
}

/**
 * Number of lines in our type stub header.
 * Used to adjust error line numbers to match the user's code.
 */
const STUB_LINE_COUNT = DISCORD_TYPE_STUBS.split("\n").length;

/**
 * Validates the generated code for TypeScript syntax errors.
 *
 * Uses the TypeScript Compiler API to parse the code in-memory
 * without writing to disk. This catches obvious syntax errors
 * like missing brackets, invalid syntax, etc.
 *
 * Note: This is syntax checking only, not full type checking.
 * The code may still have runtime errors that aren't caught here.
 *
 * @param mainFunctionBody - The generated main() function body code
 * @returns ValidationResult with valid flag and any errors found
 *
 * @example
 * ```ts
 * const result = yield* validateCode("const x = 1;\nlog(x);")
 * // Returns: { valid: true, errors: [] }
 *
 * const result = yield* validateCode("const x = ")
 * // Returns: { valid: false, errors: [{ line: 1, character: 10, message: "Expression expected" }] }
 * ```
 */
export const validateCode = Effect.fn("CodeMode.validateCode")(function* (mainFunctionBody: string) {
        const startTime = Date.now();

        // Wrap the user code in an async function context for validation
        const fullCode = `
${DISCORD_TYPE_STUBS}

async function main() {
${mainFunctionBody}
}
`;

        const result = yield* Effect.sync(() => {
            // Create in-memory source file
            const fileName = "generated-code.ts";
            const sourceFile = ts.createSourceFile(
                fileName,
                fullCode,
                ts.ScriptTarget.ESNext,
                true, // setParentNodes
                ts.ScriptKind.TS,
            );

            // Create a minimal compiler host for in-memory compilation
            const compilerHost: ts.CompilerHost = {
                getSourceFile: (name) => {
                    if (name === fileName) return sourceFile;
                    // Return undefined for other files - we only care about our code
                    return undefined;
                },
                getDefaultLibFileName: () => "lib.d.ts",
                writeFile: () => {}, // No-op
                getCurrentDirectory: () => "",
                getCanonicalFileName: (f) => f,
                useCaseSensitiveFileNames: () => true,
                getNewLine: () => "\n",
                fileExists: (f) => f === fileName,
                readFile: () => undefined,
            };

            // Create program with permissive settings (syntax-focused)
            const program = ts.createProgram(
                [fileName],
                {
                    target: ts.ScriptTarget.ESNext,
                    module: ts.ModuleKind.ESNext,
                    strict: false,
                    noEmit: true,
                    skipLibCheck: true,
                    noImplicitAny: false,
                    allowJs: true,
                },
                compilerHost,
            );

            // Get syntactic diagnostics (most important for generated code)
            const syntaxDiagnostics = program.getSyntacticDiagnostics(sourceFile);

            // Map diagnostics to our error format
            const errors = syntaxDiagnostics.map((diagnostic) => {
                const position =
                    diagnostic.file && diagnostic.start !== undefined
                        ? ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start)
                        : { line: 0, character: 0 };

                // Adjust line number to account for our wrapper:
                // - Subtract stub lines
                // - Subtract "async function main() {" line (2 lines: blank + declaration)
                const adjustedLine = Math.max(1, position.line - STUB_LINE_COUNT - 2 + 1);

                return {
                    line: adjustedLine,
                    character: position.character + 1, // 1-indexed
                    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
                };
            });

            return {
                valid: errors.length === 0,
                errors,
            };
        });

        yield* Effect.logDebug("code validation completed", {
            valid: result.valid,
            error_count: result.errors.length,
            errors: result.errors.slice(0, 5), // Log first 5 errors
            code_lines: mainFunctionBody.split("\n").length,
            duration_ms: Date.now() - startTime,
        });

        return result;
    },
);
