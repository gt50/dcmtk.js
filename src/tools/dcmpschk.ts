/**
 * Check a DICOM presentation state for consistency using the dcmpschk binary.
 *
 * Validates a Grayscale Softcopy Presentation State (GSPS) object
 * and reports any inconsistencies or errors found.
 *
 * @module dcmpschk
 */

import { z } from 'zod';
import type { Result } from '../types';
import { ok, err } from '../types';
import { execCommand } from '../exec';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import { resolveBinary } from './_resolveBinary';
import { createToolError, createValidationError } from './_toolError';
import type { ToolBaseOptions } from './_toolTypes';

/** Options for {@link dcmpschk}. */
interface DcmpschkOptions extends ToolBaseOptions {
    /** Verbosity level for diagnostic output. `'verbose'` maps to `-v`, `'debug'` maps to `-d`. */
    readonly verbosity?: 'verbose' | 'debug' | undefined;
}

/** Result of a successful dcmpschk operation. */
interface DcmpschkResult {
    /** The text output from dcmpschk. */
    readonly text: string;
}

const DcmpschkOptionsSchema = z
    .object({
        timeoutMs: z.number().int().positive().optional(),
        signal: z.instanceof(AbortSignal).optional(),
        verbosity: z.enum(['verbose', 'debug']).optional(),
    })
    .strict()
    .optional();

/** Maps verbosity level to command-line flag. */
const VERBOSITY_FLAGS: Record<'verbose' | 'debug', string> = { verbose: '-v', debug: '-d' };

/**
 * Builds dcmpschk command-line arguments from validated options.
 */
function buildArgs(inputPath: string, options?: DcmpschkOptions): string[] {
    const args: string[] = [];

    if (options?.verbosity !== undefined) {
        args.push(VERBOSITY_FLAGS[options.verbosity]);
    }

    args.push(inputPath);

    return args;
}

/**
 * Checks a DICOM presentation state for consistency using the dcmpschk binary.
 *
 * @param inputPath - Path to the presentation state DICOM file
 * @param options - Optional execution options
 * @returns A Result containing the validation text output or an error
 *
 * @example
 * ```ts
 * const result = await dcmpschk('/path/to/pstate.dcm');
 * if (result.ok) {
 *     console.log(result.value.text);
 * }
 * ```
 */
async function dcmpschk(inputPath: string, options?: DcmpschkOptions): Promise<Result<DcmpschkResult>> {
    const validation = DcmpschkOptionsSchema.safeParse(options);
    if (!validation.success) {
        return err(createValidationError('dcmpschk', validation.error));
    }

    const binaryResult = resolveBinary('dcmpschk');
    if (!binaryResult.ok) {
        return err(binaryResult.error);
    }

    const args = buildArgs(inputPath, options);
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const result = await execCommand(binaryResult.value, args, {
        timeoutMs,
        signal: options?.signal,
    });

    if (!result.ok) {
        return err(result.error);
    }

    if (result.value.exitCode !== 0) {
        return err(createToolError('dcmpschk', args, result.value.exitCode, result.value.stderr));
    }

    return ok({ text: result.value.stdout });
}

export { dcmpschk };
export type { DcmpschkOptions, DcmpschkResult };
