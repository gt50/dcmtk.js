/**
 * C-STORE send using the dcmsend binary.
 *
 * Sends one or more DICOM files to a remote DICOM SCP.
 *
 * @module dcmsend
 */

import { z } from 'zod';
import type { Result } from '../types';
import { ok, err } from '../types';
import { execCommand } from '../exec';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import { resolveBinary } from './_resolveBinary';
import { createToolError, createValidationError } from './_toolError';
import type { ToolBaseOptions } from './_toolTypes';
import { isSafePath, isValidAETitle } from '../patterns';

/** Options for {@link dcmsend}. */
interface DcmsendOptions extends ToolBaseOptions {
    /** Remote host or IP address. */
    readonly host: string;
    /** Remote port number. */
    readonly port: number;
    /** One or more DICOM file paths to send. */
    readonly files: readonly string[];
    /** Calling AE Title. */
    readonly callingAETitle?: string | undefined;
    /** Called AE Title. */
    readonly calledAETitle?: string | undefined;
    /** Scan input directory recursively for DICOM files. Defaults to false. */
    readonly scanDirectory?: boolean | undefined;
    /** Recurse into subdirectories (requires scanDirectory). Maps to `+r`. */
    readonly recurse?: boolean | undefined;
    /** Scan pattern for filename filtering (only with scanDirectory). Maps to `--scan-pattern`. */
    readonly scanPattern?: string | undefined;
    /** Verbosity level for diagnostic output. `'verbose'` maps to `-v`, `'debug'` maps to `-d`. */
    readonly verbosity?: 'verbose' | 'debug' | undefined;
    /** Disable UID validity checking. Maps to `--no-uid-checks`. */
    readonly noUidChecks?: boolean | undefined;
    /** Do not halt on first invalid input file. Maps to `--no-halt`. */
    readonly noHalt?: boolean | undefined;
    /** Do not propose illegal presentation contexts. Maps to `--no-illegal-proposal`. */
    readonly noIllegalProposal?: boolean | undefined;
    /** Decompression mode. Maps to `--decompress-never` / `--decompress-lossless` / `--decompress-lossy`. */
    readonly decompress?: 'never' | 'lossless' | 'lossy' | undefined;
    /** Use multiple associations (one after the other). Maps to `+ma`. False maps to `-ma`. */
    readonly multiAssociations?: boolean | undefined;
    /** Create a detailed report file on the transfer. Maps to `--create-report-file`. */
    readonly createReportFile?: string | undefined;
    /** Maximum receive PDU size in bytes (4096–131072). Maps to `--max-pdu`. */
    readonly maxPduReceive?: number | undefined;
    /** Maximum send PDU size in bytes (4096–131072). Maps to `--max-send-pdu`. */
    readonly maxPduSend?: number | undefined;
    /** Disable hostname lookup for incoming associations. Maps to `-nh`. */
    readonly noHostnameLookup?: boolean | undefined;
    /** Association timeout in seconds (positive integer). Maps to `-to`. */
    readonly associationTimeout?: number | undefined;
    /** ACSE timeout in seconds. Maps to `-ta`. */
    readonly acseTimeout?: number | undefined;
    /** DIMSE timeout in seconds. Maps to `-td`. */
    readonly dimseTimeout?: number | undefined;
}

/** Result of a successful C-STORE send. */
interface DcmsendResult {
    /** Whether the send completed successfully. */
    readonly success: boolean;
    /** Raw stdout output. */
    readonly stdout: string;
    /** Raw stderr output for diagnostic info. */
    readonly stderr: string;
}

/** Maps verbosity level to command-line flag. */
const VERBOSITY_FLAGS: Record<'verbose' | 'debug', string> = { verbose: '-v', debug: '-d' };

/** Maps decompress mode to command-line flag. */
const DECOMPRESS_FLAGS: Record<'never' | 'lossless' | 'lossy', string> = {
    never: '--decompress-never',
    lossless: '--decompress-lossless',
    lossy: '--decompress-lossy',
};

/** Appends dcmsend-specific send mode arguments. */
function pushSendModeArgs(args: string[], options: DcmsendOptions): void {
    if (options.noHalt === true) {
        args.push('--no-halt');
    }
    if (options.noIllegalProposal === true) {
        args.push('--no-illegal-proposal');
    }
    if (options.decompress !== undefined) {
        args.push(DECOMPRESS_FLAGS[options.decompress]);
    }
    if (options.multiAssociations === true) {
        args.push('+ma');
    } else if (options.multiAssociations === false) {
        args.push('-ma');
    }
    if (options.createReportFile !== undefined) {
        args.push('--create-report-file', options.createReportFile);
    }
}

const DcmsendOptionsSchema = z
    .object({
        timeoutMs: z.number().int().positive().optional(),
        signal: z.instanceof(AbortSignal).optional(),
        host: z.string().min(1),
        port: z.number().int().min(1).max(65535),
        files: z.array(z.string().min(1).refine(isSafePath, { message: 'path traversal detected in file path' })).min(1),
        callingAETitle: z.string().min(1).max(16).refine(isValidAETitle, { message: 'AE Title contains invalid characters' }).optional(),
        calledAETitle: z.string().min(1).max(16).refine(isValidAETitle, { message: 'AE Title contains invalid characters' }).optional(),
        scanDirectory: z.boolean().optional(),
        recurse: z.boolean().optional(),
        scanPattern: z.string().min(1).optional(),
        verbosity: z.enum(['verbose', 'debug']).optional(),
        noUidChecks: z.boolean().optional(),
        noHalt: z.boolean().optional(),
        noIllegalProposal: z.boolean().optional(),
        decompress: z.enum(['never', 'lossless', 'lossy']).optional(),
        multiAssociations: z.boolean().optional(),
        createReportFile: z.string().min(1).optional(),
        maxPduReceive: z.number().int().min(4096).max(131072).optional(),
        maxPduSend: z.number().int().min(4096).max(131072).optional(),
        noHostnameLookup: z.boolean().optional(),
        associationTimeout: z.number().int().positive().optional(),
        acseTimeout: z.number().int().positive().optional(),
        dimseTimeout: z.number().int().positive().optional(),
    })
    .strict();

/** Appends network and protocol arguments (AE titles, PDU, timeouts). */
function pushNetworkArgs(args: string[], options: DcmsendOptions): void {
    if (options.callingAETitle !== undefined) {
        args.push('-aet', options.callingAETitle);
    }

    if (options.calledAETitle !== undefined) {
        args.push('-aec', options.calledAETitle);
    }

    if (options.noUidChecks === true) {
        args.push('--no-uid-checks');
    }

    if (options.maxPduReceive !== undefined) {
        args.push('--max-pdu', String(options.maxPduReceive));
    }

    if (options.maxPduSend !== undefined) {
        args.push('--max-send-pdu', String(options.maxPduSend));
    }

    if (options.noHostnameLookup === true) {
        args.push('-nh');
    }

    if (options.associationTimeout !== undefined) {
        args.push('-to', String(options.associationTimeout));
    }

    if (options.acseTimeout !== undefined) {
        args.push('-ta', String(options.acseTimeout));
    }

    if (options.dimseTimeout !== undefined) {
        args.push('-td', String(options.dimseTimeout));
    }
}

/**
 * Builds dcmsend command-line arguments from validated options.
 */
function buildArgs(options: DcmsendOptions): string[] {
    const args: string[] = [];

    if (options.verbosity !== undefined) {
        args.push(VERBOSITY_FLAGS[options.verbosity]);
    }

    pushNetworkArgs(args, options);

    if (options.scanDirectory === true) {
        args.push('--scan-directories');
    }

    if (options.recurse === true) {
        args.push('+r');
    }

    if (options.scanPattern !== undefined) {
        args.push('--scan-pattern', options.scanPattern);
    }

    pushSendModeArgs(args, options);

    args.push(options.host, String(options.port));
    args.push(...options.files);

    return args;
}

/**
 * Sends DICOM files to a remote SCP using C-STORE via the dcmsend binary.
 *
 * @param options - Send options (host, port, files required)
 * @returns A Result containing the send result or an error
 *
 * @example
 * ```ts
 * const result = await dcmsend({
 *     host: '192.168.1.100',
 *     port: 104,
 *     files: ['/path/to/study.dcm'],
 *     calledAETitle: 'PACS',
 * });
 * if (result.ok && result.value.success) {
 *     console.log('Files sent successfully');
 * }
 * ```
 */
async function dcmsend(options: DcmsendOptions): Promise<Result<DcmsendResult>> {
    const validation = DcmsendOptionsSchema.safeParse(options);
    if (!validation.success) {
        return err(createValidationError('dcmsend', validation.error));
    }

    const binaryResult = resolveBinary('dcmsend');
    if (!binaryResult.ok) {
        return err(binaryResult.error);
    }

    const args = buildArgs(options);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const result = await execCommand(binaryResult.value, args, {
        timeoutMs,
        signal: options.signal,
    });

    if (!result.ok) {
        return err(result.error);
    }

    if (result.value.exitCode !== 0) {
        return err(createToolError('dcmsend', args, result.value.exitCode, result.value.stderr, result.value.stdout));
    }

    return ok({ success: true, stdout: result.value.stdout, stderr: result.value.stderr });
}

export { dcmsend };
export type { DcmsendOptions, DcmsendResult };
