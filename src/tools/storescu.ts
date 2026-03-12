/**
 * Send DICOM files using C-STORE via the storescu binary.
 *
 * Sends one or more DICOM files to a remote DICOM SCP
 * (Service Class Provider) using the DICOM C-STORE protocol.
 *
 * @module storescu
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

// ---------------------------------------------------------------------------
// Transfer syntax proposal constants
// ---------------------------------------------------------------------------

/** Proposed transfer syntax for outgoing C-STORE associations. */
const ProposedTransferSyntax = {
    UNCOMPRESSED: 'uncompressed',
    LITTLE_ENDIAN: 'littleEndian',
    BIG_ENDIAN: 'bigEndian',
    IMPLICIT_VR: 'implicitVR',
    JPEG_LOSSLESS: 'jpegLossless',
    JPEG_8BIT: 'jpeg8Bit',
    JPEG_12BIT: 'jpeg12Bit',
    J2K_LOSSLESS: 'j2kLossless',
    J2K_LOSSY: 'j2kLossy',
    JLS_LOSSLESS: 'jlsLossless',
    JLS_LOSSY: 'jlsLossy',
} as const;

type ProposedTransferSyntaxValue = (typeof ProposedTransferSyntax)[keyof typeof ProposedTransferSyntax];

const PROPOSED_TS_FLAG_MAP: Record<ProposedTransferSyntaxValue, string> = {
    [ProposedTransferSyntax.UNCOMPRESSED]: '-x=',
    [ProposedTransferSyntax.LITTLE_ENDIAN]: '-xe',
    [ProposedTransferSyntax.BIG_ENDIAN]: '-xb',
    [ProposedTransferSyntax.IMPLICIT_VR]: '-xi',
    [ProposedTransferSyntax.JPEG_LOSSLESS]: '-xs',
    [ProposedTransferSyntax.JPEG_8BIT]: '-xy',
    [ProposedTransferSyntax.JPEG_12BIT]: '-xx',
    [ProposedTransferSyntax.J2K_LOSSLESS]: '-xv',
    [ProposedTransferSyntax.J2K_LOSSY]: '-xw',
    [ProposedTransferSyntax.JLS_LOSSLESS]: '-xt',
    [ProposedTransferSyntax.JLS_LOSSY]: '-xu',
};

/** Options for {@link storescu}. */
interface StorescuOptions extends ToolBaseOptions {
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
    /** Scan directories for DICOM files. */
    readonly scanDirectories?: boolean | undefined;
    /** Recurse into subdirectories (requires scanDirectories). */
    readonly recurse?: boolean | undefined;
    /** Proposed transfer syntax for the association. */
    readonly proposedTransferSyntax?: ProposedTransferSyntaxValue | undefined;
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
    /** Propose only the file's native transfer syntax. Maps to `-R`/`--required`. */
    readonly required?: boolean | undefined;
}

/** Result of a successful C-STORE send. */
interface StorescuResult {
    /** Whether the store completed successfully. */
    readonly success: boolean;
    /** Raw stdout output for diagnostic info. */
    readonly stdout: string;
    /** Raw stderr output for diagnostic info. */
    readonly stderr: string;
}

const StorescuOptionsSchema = z
    .object({
        timeoutMs: z.number().int().positive().optional(),
        signal: z.instanceof(AbortSignal).optional(),
        host: z.string().min(1),
        port: z.number().int().min(1).max(65535),
        files: z.array(z.string().min(1).refine(isSafePath, { message: 'path traversal detected in file path' })).min(1),
        callingAETitle: z.string().min(1).max(16).refine(isValidAETitle, { message: 'AE Title contains invalid characters' }).optional(),
        calledAETitle: z.string().min(1).max(16).refine(isValidAETitle, { message: 'AE Title contains invalid characters' }).optional(),
        scanDirectories: z.boolean().optional(),
        recurse: z.boolean().optional(),
        verbosity: z.enum(['verbose', 'debug']).optional(),
        maxPduReceive: z.number().int().min(4096).max(131072).optional(),
        maxPduSend: z.number().int().min(4096).max(131072).optional(),
        associationTimeout: z.number().int().positive().optional(),
        acseTimeout: z.number().int().positive().optional(),
        dimseTimeout: z.number().int().positive().optional(),
        noHostnameLookup: z.boolean().optional(),
        required: z.boolean().optional(),
        proposedTransferSyntax: z
            .enum([
                'uncompressed',
                'littleEndian',
                'bigEndian',
                'implicitVR',
                'jpegLossless',
                'jpeg8Bit',
                'jpeg12Bit',
                'j2kLossless',
                'j2kLossy',
                'jlsLossless',
                'jlsLossy',
            ])
            .optional(),
    })
    .strict();

/** Maps verbosity level to command-line flag. */
const VERBOSITY_FLAGS: Record<'verbose' | 'debug', string> = { verbose: '-v', debug: '-d' };

/** Detects DIMSE-level send failures in storescu stderr (exit code may still be 0). */
const DIMSE_ERROR_PATTERN = /^E:.*(?:DIMSE Failed|Store Failed)/m;

/** Appends common network flags to the argument list. */
function pushNetworkArgs(args: string[], options: StorescuOptions): void {
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
 * Builds storescu command-line arguments from validated options.
 */
function buildArgs(options: StorescuOptions): string[] {
    const args: string[] = [];
    pushNetworkArgs(args, options);

    if (options.callingAETitle !== undefined) {
        args.push('-aet', options.callingAETitle);
    }

    if (options.calledAETitle !== undefined) {
        args.push('-aec', options.calledAETitle);
    }

    if (options.scanDirectories === true) {
        args.push('+sd');
    }

    if (options.recurse === true) {
        args.push('+r');
    }

    if (options.proposedTransferSyntax !== undefined) {
        args.push(PROPOSED_TS_FLAG_MAP[options.proposedTransferSyntax]);
    }

    if (options.required === true) {
        args.push('-R');
    }

    args.push(options.host, String(options.port));
    args.push(...options.files);

    return args;
}

/**
 * Send DICOM files using C-STORE via the storescu binary.
 *
 * @param options - Store options (host, port, files required)
 * @returns A Result containing the store result or an error
 *
 * @example
 * ```ts
 * const result = await storescu({
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
async function storescu(options: StorescuOptions): Promise<Result<StorescuResult>> {
    const validation = StorescuOptionsSchema.safeParse(options);
    if (!validation.success) {
        return err(createValidationError('storescu', validation.error));
    }

    const binaryResult = resolveBinary('storescu');
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
        return err(createToolError('storescu', args, result.value.exitCode, result.value.stderr));
    }

    if (DIMSE_ERROR_PATTERN.test(result.value.stderr)) {
        return err(createToolError('storescu', args, 0, result.value.stderr));
    }

    return ok({ success: true, stdout: result.value.stdout, stderr: result.value.stderr });
}

export { storescu, ProposedTransferSyntax };
export type { StorescuOptions, StorescuResult, ProposedTransferSyntaxValue };
