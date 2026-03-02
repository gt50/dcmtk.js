/**
 * Convert a DICOM image to PNM/PNG/BMP/TIFF format using the dcm2pnm binary.
 *
 * @module dcm2pnm
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
 * Output format presets for dcm2pnm.
 */
const Dcm2pnmOutputFormat = {
    /** Portable aNy Map format. */
    PNM: 'pnm',
    /** PNG format. */
    PNG: 'png',
    /** 16-bit PNG format. */
    PNG_16BIT: 'png16',
    /** BMP format. */
    BMP: 'bmp',
    /** TIFF format. */
    TIFF: 'tiff',
} as const;

type Dcm2pnmOutputFormatValue = (typeof Dcm2pnmOutputFormat)[keyof typeof Dcm2pnmOutputFormat];

const DCM2PNM_FORMAT_FLAGS: Record<Dcm2pnmOutputFormatValue, string> = {
    pnm: '+op',
    png: '+on',
    png16: '+on2',
    bmp: '+ob',
    tiff: '+ot',
};

/** Options for {@link dcm2pnm}. */
interface Dcm2pnmOptions extends ToolBaseOptions {
    /** Output image format. Defaults to PNM if not specified. */
    readonly outputFormat?: Dcm2pnmOutputFormatValue | undefined;
    /** Frame number to extract (0-based, max 65535). */
    readonly frame?: number | undefined;
    /** Window center for VOI LUT. Must be provided together with {@link windowWidth}. Maps to `+Wl`. */
    readonly windowCenter?: number | undefined;
    /** Window width for VOI LUT. Must be provided together with {@link windowCenter}. Maps to `+Wl`. */
    readonly windowWidth?: number | undefined;
    /** Verbosity level for diagnostic output. `'verbose'` maps to `-v`, `'debug'` maps to `-d`. */
    readonly verbosity?: 'verbose' | 'debug' | undefined;
}

/** Result of a successful dcm2pnm operation. */
interface Dcm2pnmResult {
    /** Path to the converted output file. */
    readonly outputPath: string;
}

const Dcm2pnmOptionsSchema = z
    .object({
        timeoutMs: z.number().int().positive().optional(),
        signal: z.instanceof(AbortSignal).optional(),
        outputFormat: z.enum(['pnm', 'png', 'png16', 'bmp', 'tiff']).optional(),
        frame: z.number().int().min(0).max(65535).optional(),
        windowCenter: z.number().optional(),
        windowWidth: z.number().optional(),
        verbosity: z.enum(['verbose', 'debug']).optional(),
    })
    .strict()
    .refine(data => (data?.windowCenter === undefined) === (data?.windowWidth === undefined), {
        message: 'windowCenter and windowWidth must be provided together',
    })
    .optional();

/** Maps verbosity level to command-line flag. */
const VERBOSITY_FLAGS: Record<'verbose' | 'debug', string> = { verbose: '-v', debug: '-d' };

/** Appends VOI window arguments when both center and width are provided. */
function pushWindowArgs(args: string[], options?: Dcm2pnmOptions): void {
    if (options?.windowCenter !== undefined && options?.windowWidth !== undefined) {
        args.push('+Wl', String(options.windowCenter), String(options.windowWidth));
    }
}

/**
 * Builds dcm2pnm command-line arguments from validated options.
 */
function buildArgs(inputPath: string, outputPath: string, options?: Dcm2pnmOptions): string[] {
    const args: string[] = [];

    if (options?.verbosity !== undefined) {
        args.push(VERBOSITY_FLAGS[options.verbosity]);
    }

    if (options?.outputFormat !== undefined) {
        args.push(DCM2PNM_FORMAT_FLAGS[options.outputFormat]);
    }

    if (options?.frame !== undefined) {
        args.push('+F', String(options.frame));
    }

    pushWindowArgs(args, options);

    args.push(inputPath, outputPath);

    return args;
}

/**
 * Convert a DICOM image to PNM/PNG/BMP/TIFF format using the dcm2pnm binary.
 *
 * @param inputPath - Path to the DICOM input file
 * @param outputPath - Path for the converted output image file
 * @param options - Optional conversion options
 * @returns A Result containing the output path or an error
 *
 * @example
 * ```ts
 * const result = await dcm2pnm('/path/to/input.dcm', '/path/to/output.png', {
 *     outputFormat: 'png',
 * });
 * if (result.ok) {
 *     console.log(`Converted: ${result.value.outputPath}`);
 * }
 * ```
 */
async function dcm2pnm(inputPath: string, outputPath: string, options?: Dcm2pnmOptions): Promise<Result<Dcm2pnmResult>> {
    const validation = Dcm2pnmOptionsSchema.safeParse(options);
    if (!validation.success) {
        return err(createValidationError('dcm2pnm', validation.error));
    }

    const dcm2imgResult = resolveBinary('dcm2img');
    const binaryResult = dcm2imgResult.ok ? dcm2imgResult : resolveBinary('dcm2pnm');
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
        return err(createToolError('dcm2pnm', args, result.value.exitCode, result.value.stderr));
    }

    return ok({ outputPath });
}

export { dcm2pnm, Dcm2pnmOutputFormat };
export type { Dcm2pnmOptions, Dcm2pnmResult, Dcm2pnmOutputFormatValue };
