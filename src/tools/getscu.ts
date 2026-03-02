/**
 * Retrieve DICOM objects using C-GET via the getscu binary.
 *
 * Sends a C-GET request to a remote DICOM SCP to retrieve
 * DICOM objects directly over the same association.
 *
 * @module getscu
 */

import { z } from 'zod';
import type { Result } from '../types';
import { ok, err } from '../types';
import { execCommand } from '../exec';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import { resolveBinary } from './_resolveBinary';
import { createToolError, createValidationError } from './_toolError';
import type { ToolBaseOptions } from './_toolTypes';
import { isSafePath, isValidDicomKey, isValidAETitle } from '../patterns';

/** Supported C-GET query models. */
const GetQueryModel = {
    PATIENT: 'patient',
    STUDY: 'study',
} as const;

/** Union of valid get query model values. */
type GetQueryModelValue = (typeof GetQueryModel)[keyof typeof GetQueryModel];

/** Maps query model values to their CLI flags. */
const GET_QUERY_MODEL_FLAGS: Record<GetQueryModelValue, string> = {
    patient: '-P',
    study: '-S',
};

/** Options for {@link getscu}. */
interface GetscuOptions extends ToolBaseOptions {
    /** Remote host or IP address. */
    readonly host: string;
    /** Remote port number. */
    readonly port: number;
    /** Calling AE Title. */
    readonly callingAETitle?: string | undefined;
    /** Called AE Title. */
    readonly calledAETitle?: string | undefined;
    /** Query model to use. */
    readonly queryModel?: GetQueryModelValue | undefined;
    /** DICOM attribute keys for the query (each becomes -k). */
    readonly keys?: readonly string[] | undefined;
    /** Output directory for retrieved files (maps to -od). */
    readonly outputDirectory?: string | undefined;
    /** Verbosity level for diagnostic output. `'verbose'` maps to `-v`, `'debug'` maps to `-d`. */
    readonly verbosity?: 'verbose' | 'debug' | undefined;
    /** Maximum receive PDU size in bytes (4096–131072). Maps to `--max-pdu`. */
    readonly maxPduReceive?: number | undefined;
    /** Maximum send PDU size in bytes (4096–131072). Maps to `--max-send-pdu`. */
    readonly maxPduSend?: number | undefined;
    /** Association/TCP connection timeout in seconds. Maps to `-to`. */
    readonly associationTimeout?: number | undefined;
    /** ACSE timeout in seconds. Maps to `-ta`. */
    readonly acseTimeout?: number | undefined;
    /** DIMSE timeout in seconds. Maps to `-td`. */
    readonly dimseTimeout?: number | undefined;
    /** Disable hostname lookup for incoming associations. Maps to `-nh`. */
    readonly noHostnameLookup?: boolean | undefined;
}

/** Result of a successful C-GET retrieval. */
interface GetscuResult {
    /** Whether the get completed successfully. */
    readonly success: boolean;
    /** Raw stderr output for diagnostic info. */
    readonly stderr: string;
}

const GetscuOptionsSchema = z
    .object({
        timeoutMs: z.number().int().positive().optional(),
        signal: z.instanceof(AbortSignal).optional(),
        host: z.string().min(1),
        port: z.number().int().min(1).max(65535),
        callingAETitle: z.string().min(1).max(16).refine(isValidAETitle, { message: 'AE Title contains invalid characters' }).optional(),
        calledAETitle: z.string().min(1).max(16).refine(isValidAETitle, { message: 'AE Title contains invalid characters' }).optional(),
        queryModel: z.enum(['patient', 'study']).optional(),
        keys: z.array(z.string().min(1).refine(isValidDicomKey, { message: 'invalid DICOM query key format (expected XXXX,XXXX[=value])' })).optional(),
        outputDirectory: z.string().min(1).refine(isSafePath, { message: 'path traversal detected in outputDirectory' }).optional(),
        verbosity: z.enum(['verbose', 'debug']).optional(),
        maxPduReceive: z.number().int().min(4096).max(131072).optional(),
        maxPduSend: z.number().int().min(4096).max(131072).optional(),
        associationTimeout: z.number().int().positive().optional(),
        acseTimeout: z.number().int().positive().optional(),
        dimseTimeout: z.number().int().positive().optional(),
        noHostnameLookup: z.boolean().optional(),
    })
    .strict();

/** Maps verbosity level to command-line flag. */
const VERBOSITY_FLAGS: Record<'verbose' | 'debug', string> = { verbose: '-v', debug: '-d' };

/** Appends common network flags to the argument list. */
function pushNetworkArgs(args: string[], options: GetscuOptions): void {
    if (options.verbosity !== undefined) {
        args.push(VERBOSITY_FLAGS[options.verbosity]);
    }
    if (options.maxPduReceive !== undefined) {
        args.push('--max-pdu', String(options.maxPduReceive));
    }
    if (options.maxPduSend !== undefined) {
        args.push('--max-send-pdu', String(options.maxPduSend));
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
    if (options.noHostnameLookup === true) {
        args.push('-nh');
    }
}

/**
 * Builds getscu command-line arguments from validated options.
 */
function buildArgs(options: GetscuOptions): string[] {
    const args: string[] = [];
    pushNetworkArgs(args, options);

    if (options.callingAETitle !== undefined) {
        args.push('-aet', options.callingAETitle);
    }

    if (options.calledAETitle !== undefined) {
        args.push('-aec', options.calledAETitle);
    }

    if (options.queryModel !== undefined) {
        args.push(GET_QUERY_MODEL_FLAGS[options.queryModel]);
    }

    if (options.outputDirectory !== undefined) {
        args.push('-od', options.outputDirectory);
    }

    if (options.keys !== undefined) {
        for (const key of options.keys) {
            args.push('-k', key);
        }
    }

    args.push(options.host, String(options.port));

    return args;
}

/**
 * Retrieve DICOM objects using C-GET via the getscu binary.
 *
 * @param options - Get options (host and port required)
 * @returns A Result containing the get result or an error
 *
 * @example
 * ```ts
 * const result = await getscu({
 *     host: '192.168.1.100',
 *     port: 104,
 *     queryModel: 'study',
 *     outputDirectory: '/tmp/dicom',
 *     keys: ['0020,000D=1.2.3.4'],
 * });
 * if (result.ok) {
 *     console.log('Get succeeded');
 * }
 * ```
 */
async function getscu(options: GetscuOptions): Promise<Result<GetscuResult>> {
    const validation = GetscuOptionsSchema.safeParse(options);
    if (!validation.success) {
        return err(createValidationError('getscu', validation.error));
    }

    const binaryResult = resolveBinary('getscu');
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
        return err(createToolError('getscu', args, result.value.exitCode, result.value.stderr));
    }

    return ok({ success: true, stderr: result.value.stderr });
}

export { getscu, GetQueryModel };
export type { GetscuOptions, GetscuResult, GetQueryModelValue };
