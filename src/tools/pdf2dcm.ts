/**
 * Encapsulate a PDF file into a DICOM object using the pdf2dcm binary.
 *
 * @module pdf2dcm
 */

import { z } from 'zod';
import type { Result } from '../types';
import { ok, err } from '../types';
import { execCommand } from '../exec';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import { resolveBinary } from './_resolveBinary';
import { createToolError, createValidationError } from './_toolError';
import type { ToolBaseOptions } from './_toolTypes';

/** Options for {@link pdf2dcm}. */
interface Pdf2dcmOptions extends ToolBaseOptions {
    /** Verbosity level for diagnostic output. `'verbose'` maps to `-v`, `'debug'` maps to `-d`. */
    readonly verbosity?: 'verbose' | 'debug' | undefined;
}

/** Result of a successful pdf2dcm operation. */
interface Pdf2dcmResult {
    /** Path to the output DICOM file. */
    readonly outputPath: string;
}

const Pdf2dcmOptionsSchema = z
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
 * Builds pdf2dcm command-line arguments from validated options.
 */
function buildArgs(inputPath: string, outputPath: string, options?: Pdf2dcmOptions): string[] {
    const args: string[] = [];

    if (options?.verbosity !== undefined) {
        args.push(VERBOSITY_FLAGS[options.verbosity]);
    }

    args.push(inputPath, outputPath);

    return args;
}

/**
 * Encapsulate a PDF file into a DICOM object using the pdf2dcm binary.
 *
 * @param inputPath - Path to the PDF input file
 * @param outputPath - Path for the output DICOM file
 * @param options - Optional execution options
 * @returns A Result containing the output path or an error
 */
async function pdf2dcm(inputPath: string, outputPath: string, options?: Pdf2dcmOptions): Promise<Result<Pdf2dcmResult>> {
    const validation = Pdf2dcmOptionsSchema.safeParse(options);
    if (!validation.success) {
        return err(createValidationError('pdf2dcm', validation.error));
    }

    const binaryResult = resolveBinary('pdf2dcm');
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
        return err(createToolError('pdf2dcm', args, result.value.exitCode, result.value.stderr));
    }

    return ok({ outputPath });
}

export { pdf2dcm };
export type { Pdf2dcmOptions, Pdf2dcmResult };
