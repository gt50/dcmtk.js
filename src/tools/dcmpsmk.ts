/**
 * Create a DICOM presentation state from an image using the dcmpsmk binary.
 *
 * Generates a Grayscale Softcopy Presentation State (GSPS)
 * object from a DICOM image file.
 *
 * @module dcmpsmk
 */

import { z } from 'zod';
import type { Result } from '../types';
import { ok, err } from '../types';
import { execCommand } from '../exec';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import { resolveBinary } from './_resolveBinary';
import { createToolError, createValidationError } from './_toolError';
import type { ToolBaseOptions } from './_toolTypes';

/** Options for {@link dcmpsmk}. */
interface DcmpsmkOptions extends ToolBaseOptions {
    /** Verbosity level for diagnostic output. `'verbose'` maps to `-v`, `'debug'` maps to `-d`. */
    readonly verbosity?: 'verbose' | 'debug' | undefined;
}

/** Result of a successful dcmpsmk operation. */
interface DcmpsmkResult {
    /** Path to the created presentation state file. */
    readonly outputPath: string;
}

const DcmpsmkOptionsSchema = z
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
 * Builds dcmpsmk command-line arguments from validated options.
 */
function buildArgs(inputPath: string, outputPath: string, options?: DcmpsmkOptions): string[] {
    const args: string[] = [];

    if (options?.verbosity !== undefined) {
        args.push(VERBOSITY_FLAGS[options.verbosity]);
    }

    args.push(inputPath, outputPath);

    return args;
}

/**
 * Creates a DICOM presentation state from an image using the dcmpsmk binary.
 *
 * @param inputPath - Path to the DICOM image input file
 * @param outputPath - Path for the created presentation state output file
 * @param options - Optional execution options
 * @returns A Result containing the output path or an error
 *
 * @example
 * ```ts
 * const result = await dcmpsmk('/path/to/image.dcm', '/path/to/pstate.dcm');
 * if (result.ok) {
 *     console.log(`Created: ${result.value.outputPath}`);
 * }
 * ```
 */
async function dcmpsmk(inputPath: string, outputPath: string, options?: DcmpsmkOptions): Promise<Result<DcmpsmkResult>> {
    const validation = DcmpsmkOptionsSchema.safeParse(options);
    if (!validation.success) {
        return err(createValidationError('dcmpsmk', validation.error));
    }

    const binaryResult = resolveBinary('dcmpsmk');
    if (!binaryResult.ok) {
        return err(binaryResult.error);
    }

    const args = buildArgs(inputPath, outputPath, options);
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const result = await execCommand(binaryResult.value, args, {
        timeoutMs,
        signal: options?.signal,
    });

    if (!result.ok) {
        return err(result.error);
    }

    if (result.value.exitCode !== 0) {
        return err(createToolError('dcmpsmk', args, result.value.exitCode, result.value.stderr));
    }

    return ok({ outputPath });
}

export { dcmpsmk };
export type { DcmpsmkOptions, DcmpsmkResult };
