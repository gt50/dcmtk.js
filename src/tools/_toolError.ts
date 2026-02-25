/**
 * Standardized error factory for tool wrappers.
 *
 * Produces consistent error messages that include the tool name, sanitized
 * arguments (truncated), exit code, and a stderr excerpt.
 *
 * @module _toolError
 * @internal
 */

/** Maximum length for the arguments portion of the error message. */
const MAX_ARGS_LENGTH = 200;

/** Maximum length for the stderr excerpt in the error message. */
const MAX_STDERR_LENGTH = 500;

/**
 * Truncates a string to a maximum length, appending "..." if truncated.
 *
 * @param value - The string to truncate
 * @param maxLength - The maximum allowed length
 * @returns The original string or a truncated version
 */
function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.substring(0, maxLength)}...`;
}

/**
 * Creates a standardized Error for a tool wrapper failure.
 *
 * **Privacy note:** Arguments are included in the error message for debugging.
 * These may contain file paths. Callers exposing errors to end users or external
 * logs should sanitize sensitive paths before display.
 *
 * @param toolName - The DCMTK binary name (e.g., "dcm2xml")
 * @param args - The command-line arguments passed to the tool
 * @param exitCode - The process exit code
 * @param stderr - The captured stderr output
 * @returns An Error with a descriptive message
 */
function createToolError(toolName: string, args: readonly string[], exitCode: number, stderr: string): Error {
    const argsStr = truncate(args.join(' '), MAX_ARGS_LENGTH);
    const stderrStr = truncate(stderr.trim(), MAX_STDERR_LENGTH);
    const parts = [`${toolName} failed (exit code ${String(exitCode)})`];
    if (argsStr.length > 0) {
        parts.push(`args: ${argsStr}`);
    }
    if (stderrStr.length > 0) {
        parts.push(`stderr: ${stderrStr}`);
    }
    return new Error(parts.join(' | '));
}

/**
 * Formats a Zod validation error into a concise, human-readable string.
 *
 * Flattens nested Zod issues into `field: message` pairs, producing
 * cleaner output than the raw Zod `.message` JSON string.
 *
 * @param toolName - The DCMTK tool name for context
 * @param zodError - The Zod error object (must have `.issues` array)
 * @returns A formatted Error
 */
function createValidationError(
    toolName: string,
    zodError: { readonly issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey>; readonly message: string }> }
): Error {
    const parts: string[] = [];
    for (let i = 0; i < zodError.issues.length; i++) {
        const issue = zodError.issues[i];
        /* v8 ignore next */
        if (issue === undefined) continue;
        const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
        parts.push(`${path}: ${issue.message}`);
    }
    const detail = parts.length > 0 ? parts.join('; ') : 'unknown validation error';
    return new Error(`${toolName}: invalid options — ${detail}`);
}

export { createToolError, createValidationError, truncate, MAX_ARGS_LENGTH, MAX_STDERR_LENGTH };
