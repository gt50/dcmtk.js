/**
 * C-ECHO verification using the echoscu binary.
 *
 * Tests DICOM network connectivity by sending a C-ECHO request
 * to a remote DICOM SCP (Service Class Provider).
 *
 * @module echoscu
 */

import { z } from 'zod';
import type { Result } from '../types';
import { ok, err } from '../types';
import { execCommand } from '../exec';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import { resolveBinary } from './_resolveBinary';
import { createToolError, createValidationError } from './_toolError';
import type { ToolBaseOptions } from './_toolTypes';
import { isValidAETitle } from '../patterns';

/** Options for {@link echoscu}. */
interface EchoscuOptions extends ToolBaseOptions {
    /** Remote host or IP address. **Security:** Not validated for SSRF — callers accepting user input should validate against private/internal IP ranges. */
    readonly host: string;
    /** Remote port number. */
    readonly port: number;
    /** Calling AE Title. */
    readonly callingAETitle?: string | undefined;
    /** Called AE Title. */
    readonly calledAETitle?: string | undefined;
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

/** Result of a successful C-ECHO. */
interface EchoscuResult {
    /** Always `true` when the Result is `ok` — redundant with `Result.ok` but kept for API compatibility. @deprecated Check `Result.ok` instead. */
    readonly success: boolean;
    /** Raw stderr output for diagnostic info. */
    readonly stderr: string;
}

const EchoscuOptionsSchema = z
    .object({
        timeoutMs: z.number().int().positive().optional(),
        signal: z.instanceof(AbortSignal).optional(),
        host: z.string().min(1),
        port: z.number().int().min(1).max(65535),
        callingAETitle: z.string().min(1).max(16).refine(isValidAETitle, { message: 'AE Title contains invalid characters' }).optional(),
        calledAETitle: z.string().min(1).max(16).refine(isValidAETitle, { message: 'AE Title contains invalid characters' }).optional(),
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
function pushNetworkArgs(args: string[], options: EchoscuOptions): void {
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
 * Builds echoscu command-line arguments from validated options.
 */
function buildArgs(options: EchoscuOptions): string[] {
    const args: string[] = [];
    pushNetworkArgs(args, options);

    if (options.callingAETitle !== undefined) {
        args.push('-aet', options.callingAETitle);
    }

    if (options.calledAETitle !== undefined) {
        args.push('-aec', options.calledAETitle);
    }

    args.push(options.host, String(options.port));

    return args;
}

/**
 * Sends a C-ECHO request to a remote DICOM SCP to verify connectivity.
 *
 * @param options - Echo options (host and port required)
 * @returns A Result containing the echo result or an error
 *
 * @example
 * ```ts
 * const result = await echoscu({ host: '192.168.1.100', port: 104 });
 * if (result.ok) {
 *     console.log(result.value.success ? 'Echo succeeded' : 'Echo failed');
 * }
 * ```
 */
async function echoscu(options: EchoscuOptions): Promise<Result<EchoscuResult>> {
    const validation = EchoscuOptionsSchema.safeParse(options);
    if (!validation.success) {
        return err(createValidationError('echoscu', validation.error));
    }

    const binaryResult = resolveBinary('echoscu');
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
        return err(createToolError('echoscu', args, result.value.exitCode, result.value.stderr));
    }

    return ok({ success: true, stderr: result.value.stderr });
}

export { echoscu };
export type { EchoscuOptions, EchoscuResult };
