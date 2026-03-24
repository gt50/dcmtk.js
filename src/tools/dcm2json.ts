/**
 * DICOM to JSON conversion using a two-phase strategy.
 *
 * Primary: dcm2xml → xmlToJson (more reliable output)
 * Fallback: dcm2json binary → repairJson → JSON.parse
 *
 * The result includes a `source` discriminant indicating which strategy succeeded.
 *
 * @module dcm2json
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stderr } from 'stderr-lib';
import { z } from 'zod';
import type { Result } from '../types';
import { ok, err } from '../types';
import { execCommand } from '../exec';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import { resolveBinary } from './_resolveBinary';
import { createToolError, createValidationError } from './_toolError';
import { xmlToJson } from './_xmlToJson';
import { repairJson } from './_repairJson';
import type { DicomJsonModel } from './_xmlToJson';
import type { ToolBaseOptions } from './_toolTypes';

/** Indicates which conversion strategy produced the result. */
type Dcm2jsonSource = 'xml' | 'direct';

/** Options for {@link dcm2json}. */
interface Dcm2jsonOptions extends ToolBaseOptions {
    /** Skip the XML primary path and use direct dcm2json only. Defaults to false. */
    readonly directOnly?: boolean | undefined;
    /** Assume the specified character set when SpecificCharacterSet (0008,0005) is absent. Passed to dcm2xml as `+Ca`. Only effective on the XML path (dcm2json binary does not support this flag). */
    readonly charsetAssume?: string | undefined;
    /** Verbosity level for diagnostic output. `'verbose'` maps to `-v`, `'debug'` maps to `-d`. */
    readonly verbosity?: 'verbose' | 'debug' | undefined;
}

/** Result of a successful dcm2json conversion. */
interface Dcm2jsonResult {
    /** The DICOM JSON Model object. */
    readonly data: DicomJsonModel;
    /** Which conversion strategy produced this result. */
    readonly source: Dcm2jsonSource;
}

const Dcm2jsonOptionsSchema = z
    .object({
        timeoutMs: z.number().int().positive().optional(),
        signal: z.instanceof(AbortSignal).optional(),
        directOnly: z.boolean().optional(),
        charsetAssume: z.string().min(1).optional(),
        verbosity: z.enum(['verbose', 'debug']).optional(),
    })
    .strict()
    .optional();

/** Options forwarded to the XML conversion path. */
type XmlPathOpts = { readonly verbosity?: 'verbose' | 'debug'; readonly charsetAssume?: string };

/** Maps verbosity level to command-line flag. */
const VERBOSITY_FLAGS: Record<'verbose' | 'debug', string> = { verbose: '-v', debug: '-d' };

/**
 * Builds verbosity args for internal calls.
 */
function buildVerbosityArgs(verbosity?: 'verbose' | 'debug'): string[] {
    if (verbosity !== undefined) {
        return [VERBOSITY_FLAGS[verbosity]];
    }
    return [];
}

/** Builds XML-path options, omitting undefined values for exactOptionalPropertyTypes. */
function buildXmlOpts(options?: Dcm2jsonOptions): XmlPathOpts {
    const result: Record<string, string> = {};
    if (options?.verbosity !== undefined) result['verbosity'] = options.verbosity;
    if (options?.charsetAssume !== undefined) result['charsetAssume'] = options.charsetAssume;
    return result;
}

/**
 * Attempts XML-primary conversion: dcm2xml → xmlToJson.
 */
async function tryXmlPath(inputPath: string, timeoutMs: number, signal?: AbortSignal, opts?: XmlPathOpts): Promise<Result<Dcm2jsonResult>> {
    const xmlBinary = resolveBinary('dcm2xml');
    if (!xmlBinary.ok) {
        return err(xmlBinary.error);
    }

    const charsetArgs = opts?.charsetAssume !== undefined ? ['+Ca', opts.charsetAssume] : [];
    const xmlArgs = [...buildVerbosityArgs(opts?.verbosity), ...charsetArgs, '-nat', inputPath];
    const xmlResult = await execCommand(xmlBinary.value, xmlArgs, { timeoutMs, signal });
    if (!xmlResult.ok) {
        return err(xmlResult.error);
    }

    if (xmlResult.value.exitCode !== 0) {
        return err(createToolError('dcm2xml', xmlArgs, xmlResult.value.exitCode, xmlResult.value.stderr));
    }

    const jsonResult = xmlToJson(xmlResult.value.stdout);
    if (!jsonResult.ok) {
        return err(jsonResult.error);
    }

    return ok({ data: jsonResult.value, source: 'xml' as const });
}

/**
 * Attempts direct conversion: dcm2json binary → repairJson → JSON.parse.
 *
 * Uses `+b +bd <tmpdir>` to redirect bulk pixel data to a temp directory
 * (discarded after parsing) so compressed pixel data does not cause failures.
 */
async function tryDirectPath(inputPath: string, timeoutMs: number, signal?: AbortSignal, verbosity?: 'verbose' | 'debug'): Promise<Result<Dcm2jsonResult>> {
    const jsonBinary = resolveBinary('dcm2json');
    if (!jsonBinary.ok) {
        return err(jsonBinary.error);
    }

    const bulkDir = await createBulkTempDir();
    const directArgs = [...buildVerbosityArgs(verbosity), '+b', '+bd', bulkDir, inputPath];

    try {
        return await execAndParse(jsonBinary.value, directArgs, inputPath, { timeoutMs, signal });
    } finally {
        rm(bulkDir, { recursive: true, force: true }).catch(() => {});
    }
}

/** Creates a temporary directory for dcm2json bulk data output. */
async function createBulkTempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'dcm2json-bulk-'));
}

/** Runs dcm2json and parses the output. */
async function execAndParse(
    binary: string,
    args: string[],
    inputPath: string,
    execOpts: { timeoutMs: number; signal?: AbortSignal }
): Promise<Result<Dcm2jsonResult>> {
    const result = await execCommand(binary, args, execOpts);
    if (!result.ok) {
        return err(result.error);
    }

    if (result.value.exitCode !== 0) {
        return err(createToolError('dcm2json', args, result.value.exitCode, result.value.stderr));
    }

    try {
        const repaired = repairJson(result.value.stdout);
        const data = JSON.parse(repaired) as DicomJsonModel;
        return ok({ data, source: 'direct' as const });
    } catch (parseError: unknown) {
        return err(createToolError('dcm2json', [inputPath], 1, `Parse error: ${stderr(parseError).message}`));
    }
}

/**
 * Converts a DICOM file to the DICOM JSON Model.
 *
 * Uses a two-phase strategy:
 * 1. Primary: dcm2xml → XML-to-JSON conversion (more reliable)
 * 2. Fallback: direct dcm2json binary with JSON repair
 *
 * @param inputPath - Path to the DICOM input file
 * @param options - Conversion options
 * @returns A Result containing the DICOM JSON Model with source discriminant
 *
 * @example
 * ```ts
 * const result = await dcm2json('/path/to/study.dcm');
 * if (result.ok) {
 *     console.log(result.value.source); // 'xml' or 'direct'
 *     console.log(result.value.data['00100010']); // Patient Name
 * }
 * ```
 */
async function dcm2json(inputPath: string, options?: Dcm2jsonOptions): Promise<Result<Dcm2jsonResult>> {
    const validation = Dcm2jsonOptionsSchema.safeParse(options);
    if (!validation.success) {
        return err(createValidationError('dcm2json', validation.error));
    }

    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const signal = options?.signal;

    const verbosity = options?.verbosity;

    // Direct-only mode: skip XML path
    if (options?.directOnly === true) {
        return tryDirectPath(inputPath, timeoutMs, signal, verbosity);
    }

    // Try XML path first
    const xmlResult = await tryXmlPath(inputPath, timeoutMs, signal, buildXmlOpts(options));
    if (xmlResult.ok) {
        return xmlResult;
    }

    // Fall back to direct path
    return tryDirectPath(inputPath, timeoutMs, signal, verbosity);
}

export { dcm2json };
export type { Dcm2jsonOptions, Dcm2jsonResult, Dcm2jsonSource, DicomJsonModel };
