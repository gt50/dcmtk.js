/**
 * Convert an STL file to a DICOM object using the stl2dcm binary.
 *
 * @module stl2dcm
 */

import { z } from 'zod';
import type { Result } from '../types';
import { ok, err } from '../types';
import { execCommand } from '../exec';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import { resolveBinary } from './_resolveBinary';
import { createToolError, createValidationError } from './_toolError';
import type { ToolBaseOptions } from './_toolTypes';

/** Options for {@link stl2dcm}. */
interface Stl2dcmOptions extends ToolBaseOptions {
    /** Verbosity level for diagnostic output. `'verbose'` maps to `-v`, `'debug'` maps to `-d`. */
    readonly verbosity?: 'verbose' | 'debug' | undefined;
}

/** Result of a successful stl2dcm conversion. */
interface Stl2dcmResult {
    /** Path to the generated DICOM output file. */
    readonly outputPath: string;
}

const Stl2dcmOptionsSchema = z
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
 * Builds stl2dcm command-line arguments from validated options.
 */
function buildArgs(inputPath: string, outputPath: string, options?: Stl2dcmOptions): string[] {
    const args: string[] = [];

    if (options?.verbosity !== undefined) {
        args.push(VERBOSITY_FLAGS[options.verbosity]);
    }

    args.push(inputPath, outputPath);

    return args;
}

/**
 * Converts an STL file to a DICOM object using the stl2dcm binary.
 *
 * @param inputPath - Path to the STL input file
 * @param outputPath - Path for the DICOM output file
 * @param options - Conversion options
 * @returns A Result containing the output path or an error
 *
 * @example
 * ```ts
 * const result = await stl2dcm('/path/to/model.stl', '/path/to/output.dcm');
 * if (result.ok) {
 *     console.log(`Created: ${result.value.outputPath}`);
 * }
 * ```
 */
async function stl2dcm(inputPath: string, outputPath: string, options?: Stl2dcmOptions): Promise<Result<Stl2dcmResult>> {
    const validation = Stl2dcmOptionsSchema.safeParse(options);
    if (!validation.success) {
        return err(createValidationError('stl2dcm', validation.error));
    }

    const binaryResult = resolveBinary('stl2dcm');
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
        return err(createToolError('stl2dcm', args, result.value.exitCode, result.value.stderr));
    }

    return ok({ outputPath });
}

export { stl2dcm };
export type { Stl2dcmOptions, Stl2dcmResult };
