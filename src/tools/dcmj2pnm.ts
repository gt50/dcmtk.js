/**
 * Convert a DICOM image to a standard image format using the dcmj2pnm binary.
 *
 * @module dcmj2pnm
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
 * Output format presets for dcmj2pnm.
 */
const Dcmj2pnmOutputFormat = {
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
    /** JPEG format. */
    JPEG: 'jpeg',
} as const;

type Dcmj2pnmOutputFormatValue = (typeof Dcmj2pnmOutputFormat)[keyof typeof Dcmj2pnmOutputFormat];

const OUTPUT_FORMAT_FLAGS: Record<Dcmj2pnmOutputFormatValue, string> = {
    pnm: '+op',
    png: '+on',
    png16: '+on2',
    bmp: '+ob',
    tiff: '+ot',
    jpeg: '+oj',
};

/** Options for {@link dcmj2pnm}. */
interface Dcmj2pnmOptions extends ToolBaseOptions {
    /** Output image format. Defaults to PNM if not specified. */
    readonly outputFormat?: Dcmj2pnmOutputFormatValue | undefined;
    /** Frame number to extract (0-based). */
    readonly frame?: number | undefined;
    /** Window center for VOI LUT. Must be provided together with {@link windowWidth}. Maps to `+Wl`. */
    readonly windowCenter?: number | undefined;
    /** Window width for VOI LUT. Must be provided together with {@link windowCenter}. Maps to `+Wl`. */
    readonly windowWidth?: number | undefined;
}

/** Result of a successful dcmj2pnm operation. */
interface Dcmj2pnmResult {
    /** Path to the converted output file. */
    readonly outputPath: string;
}

const Dcmj2pnmOptionsSchema = z
    .object({
        timeoutMs: z.number().int().positive().optional(),
        signal: z.instanceof(AbortSignal).optional(),
        outputFormat: z.enum(['pnm', 'png', 'png16', 'bmp', 'tiff', 'jpeg']).optional(),
        frame: z.number().int().min(0).max(65535).optional(),
        windowCenter: z.number().optional(),
        windowWidth: z.number().optional(),
    })
    .strict()
    .refine(data => (data?.windowCenter === undefined) === (data?.windowWidth === undefined), {
        message: 'windowCenter and windowWidth must be provided together',
    })
    .optional();

/**
 * Builds dcmj2pnm command-line arguments from validated options.
 */
function buildArgs(inputPath: string, outputPath: string, options?: Dcmj2pnmOptions): string[] {
    const args: string[] = [];

    if (options?.outputFormat !== undefined) {
        args.push(OUTPUT_FORMAT_FLAGS[options.outputFormat]);
    }

    if (options?.frame !== undefined) {
        args.push('+F', String(options.frame));
    }

    if (options?.windowCenter !== undefined && options?.windowWidth !== undefined) {
        args.push('+Wl', String(options.windowCenter), String(options.windowWidth));
    }

    args.push(inputPath, outputPath);

    return args;
}

/**
 * Convert a DICOM image to a standard image format using the dcmj2pnm binary.
 *
 * @param inputPath - Path to the DICOM input file
 * @param outputPath - Path for the converted output image file
 * @param options - Optional conversion options
 * @returns A Result containing the output path or an error
 *
 * @example
 * ```ts
 * const result = await dcmj2pnm('/path/to/input.dcm', '/path/to/output.png', {
 *     outputFormat: 'png',
 * });
 * if (result.ok) {
 *     console.log(`Converted: ${result.value.outputPath}`);
 * }
 * ```
 */
async function dcmj2pnm(inputPath: string, outputPath: string, options?: Dcmj2pnmOptions): Promise<Result<Dcmj2pnmResult>> {
    const validation = Dcmj2pnmOptionsSchema.safeParse(options);
    if (!validation.success) {
        return err(createValidationError('dcmj2pnm', validation.error));
    }

    const dcm2imgResult = resolveBinary('dcm2img');
    const binaryResult = dcm2imgResult.ok ? dcm2imgResult : resolveBinary('dcmj2pnm');
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
        return err(createToolError('dcmj2pnm', args, result.value.exitCode, result.value.stderr));
    }

    return ok({ outputPath });
}

export { dcmj2pnm, Dcmj2pnmOutputFormat };
export type { Dcmj2pnmOptions, Dcmj2pnmResult, Dcmj2pnmOutputFormatValue };
