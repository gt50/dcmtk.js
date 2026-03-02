/**
 * Dump DICOM metadata as text using the dcmdump binary.
 *
 * @module dcmdump
 */

import { z } from 'zod';
import type { Result } from '../types';
import { ok, err } from '../types';
import { execCommand } from '../exec';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import { resolveBinary } from './_resolveBinary';
import { createToolError, createValidationError } from './_toolError';
import type { ToolBaseOptions } from './_toolTypes';

/**
 * Output format for dcmdump.
 */
const DcmdumpFormat = {
    /** Print standard DCMTK format. */
    STANDARD: 'standard',
    /** Print tag and value only. */
    SHORT: 'short',
} as const;

type DcmdumpFormatValue = (typeof DcmdumpFormat)[keyof typeof DcmdumpFormat];

/** Options for {@link dcmdump}. */
interface DcmdumpOptions extends ToolBaseOptions {
    /** Output format. Defaults to 'standard'. */
    readonly format?: DcmdumpFormatValue | undefined;
    /** Print all tags including private tags. Defaults to false. */
    readonly allTags?: boolean | undefined;
    /** Search for a specific tag. */
    readonly searchTag?: string | undefined;
    /** Print tag values with enhanced detail. Defaults to false. */
    readonly printValues?: boolean | undefined;
    /** Verbosity level for diagnostic output. `'verbose'` maps to `-v`, `'debug'` maps to `-d`. */
    readonly verbosity?: 'verbose' | 'debug' | undefined;
}

/** Result of a successful dcmdump operation. */
interface DcmdumpResult {
    /** The text output from dcmdump. */
    readonly text: string;
}

/** Maps verbosity level to command-line flag. */
const VERBOSITY_FLAGS: Record<'verbose' | 'debug', string> = { verbose: '-v', debug: '-d' };

const DcmdumpOptionsSchema = z
    .object({
        timeoutMs: z.number().int().positive().optional(),
        signal: z.instanceof(AbortSignal).optional(),
        format: z.enum(['standard', 'short']).optional(),
        allTags: z.boolean().optional(),
        searchTag: z
            .string()
            .regex(/^\([0-9A-Fa-f]{4},[0-9A-Fa-f]{4}\)$/)
            .optional(),
        printValues: z.boolean().optional(),
        verbosity: z.enum(['verbose', 'debug']).optional(),
    })
    .strict()
    .optional();

/** Appends display-related arguments (format, tags, values). */
function pushDisplayArgs(args: string[], options?: DcmdumpOptions): void {
    if (options?.format === 'short') {
        args.push('+L');
    }

    if (options?.allTags === true) {
        args.push('+P', 'all');
    }

    if (options?.searchTag !== undefined) {
        // Strip parentheses: dcmdump expects "gggg,eeee" not "(gggg,eeee)"
        const tag = options.searchTag.replace(/[()]/g, '');
        args.push('+P', tag);
    }

    if (options?.printValues === true) {
        args.push('+Vr');
    }
}

/**
 * Builds dcmdump command-line arguments from validated options.
 */
function buildArgs(inputPath: string, options?: DcmdumpOptions): string[] {
    const args: string[] = [];

    if (options?.verbosity !== undefined) {
        args.push(VERBOSITY_FLAGS[options.verbosity]);
    }

    pushDisplayArgs(args, options);

    args.push(inputPath);

    return args;
}

/**
 * Dumps DICOM metadata as text using the dcmdump binary.
 *
 * @param inputPath - Path to the DICOM input file
 * @param options - Dump options
 * @returns A Result containing the text dump or an error
 *
 * @example
 * ```ts
 * const result = await dcmdump('/path/to/study.dcm');
 * if (result.ok) {
 *     console.log(result.value.text);
 * }
 * ```
 */
async function dcmdump(inputPath: string, options?: DcmdumpOptions): Promise<Result<DcmdumpResult>> {
    const validation = DcmdumpOptionsSchema.safeParse(options);
    if (!validation.success) {
        return err(createValidationError('dcmdump', validation.error));
    }

    const binaryResult = resolveBinary('dcmdump');
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
        return err(createToolError('dcmdump', args, result.value.exitCode, result.value.stderr));
    }

    return ok({ text: result.value.stdout });
}

export { dcmdump, DcmdumpFormat };
export type { DcmdumpOptions, DcmdumpResult, DcmdumpFormatValue };
