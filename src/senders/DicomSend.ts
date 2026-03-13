/**
 * High-throughput DICOM sender using the dcmsend binary.
 *
 * Similar interface to {@link DicomSender} but wraps `dcmsend` instead of
 * `storescu`. `dcmsend` automatically proposes each file's native transfer
 * syntax, avoiding the need for codec licenses when sending compressed data.
 *
 * @module senders/DicomSend
 */

import { EventEmitter } from 'node:events';
import { z } from 'zod';
import type { Result } from '../types';
import { ok, err } from '../types';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import { isValidAETitle } from '../patterns';
import { createValidationError } from '../tools/_toolError';
import { dcmsend } from '../tools/dcmsend';
import { SenderEngine } from './SenderEngine';
import type { SendExecutor } from './SenderEngine';
import type { SendResult, SenderStatus, SenderSendCompleteData, SenderSendFailedData, SenderHealthChangedData, SenderBucketFlushedData } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ASSOCIATIONS = 4;
const DEFAULT_MAX_QUEUE_LENGTH = 1000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_BUCKET_FLUSH_MS = 5000;
const DEFAULT_MAX_BUCKET_SIZE = 50;
const MAX_ASSOCIATIONS_LIMIT = 64;

// ---------------------------------------------------------------------------
// Options & event types
// ---------------------------------------------------------------------------

/** Options for creating a DicomSend instance. */
interface DicomSendOptions {
    /** Remote host or IP address (required). */
    readonly host: string;
    /** Remote port number, 1-65535 (required). */
    readonly port: number;
    /** Called AE Title of the remote SCP (max 16 chars). */
    readonly calledAETitle?: string | undefined;
    /** Calling AE Title of the local SCU (max 16 chars). */
    readonly callingAETitle?: string | undefined;
    /** Sending mode. Defaults to 'multiple'. */
    readonly mode?: 'single' | 'multiple' | 'bucket' | undefined;
    /** Maximum concurrent dcmsend calls. Defaults to 4 (forced to 1 in single mode). */
    readonly maxAssociations?: number | undefined;
    /** Maximum queued send requests before rejecting. Defaults to 1000. */
    readonly maxQueueLength?: number | undefined;
    /** Per-dcmsend timeout in milliseconds. Defaults to 30000. */
    readonly timeoutMs?: number | undefined;
    /** Maximum retry attempts per send (0 = no retry). Defaults to 3. */
    readonly maxRetries?: number | undefined;
    /** Base retry delay in milliseconds. Defaults to 1000. */
    readonly retryDelayMs?: number | undefined;
    /** Bucket flush timeout in milliseconds (bucket mode only). Defaults to 5000. */
    readonly bucketFlushMs?: number | undefined;
    /** Maximum files per bucket before auto-flush (bucket mode only). Defaults to 50. */
    readonly maxBucketSize?: number | undefined;
    /** Maximum PDU receive size (4096-131072). Maps to `--max-pdu`. */
    readonly maxPduReceive?: number | undefined;
    /** Maximum PDU send size (4096-131072). Maps to `--max-send-pdu`. */
    readonly maxPduSend?: number | undefined;
    /** Association timeout in seconds. Maps to `-to`. */
    readonly associationTimeout?: number | undefined;
    /** ACSE timeout in seconds. Maps to `-ta`. */
    readonly acseTimeout?: number | undefined;
    /** DIMSE timeout in seconds. Maps to `-td`. */
    readonly dimseTimeout?: number | undefined;
    /** Disable DNS hostname lookup. Maps to `-nh`. */
    readonly noHostnameLookup?: boolean | undefined;
    /** Verbosity level. `'verbose'` maps to `-v`, `'debug'` maps to `-d`. */
    readonly verbosity?: 'verbose' | 'debug' | undefined;
    /** Do not halt on first invalid input file. Maps to `--no-halt`. */
    readonly noHalt?: boolean | undefined;
    /** Do not propose illegal presentation contexts. Maps to `--no-illegal-proposal`. */
    readonly noIllegalProposal?: boolean | undefined;
    /** Decompression mode. Maps to `--decompress-never`/`--decompress-lossless`/`--decompress-lossy`. */
    readonly decompress?: 'never' | 'lossless' | 'lossy' | undefined;
    /** Use multiple associations (one after the other). `true` maps to `+ma`, `false` maps to `-ma`. */
    readonly multiAssociations?: boolean | undefined;
    /** Disable UID validity checking. Maps to `--no-uid-checks`. */
    readonly noUidChecks?: boolean | undefined;
    /** AbortSignal for external cancellation. */
    readonly signal?: AbortSignal | undefined;
}

/** Per-send options for DicomSend. */
interface DcmsendSendOptions {
    /** Override per-dcmsend timeout for this send. */
    readonly timeoutMs?: number | undefined;
    /** Override max retries for this send. */
    readonly maxRetries?: number | undefined;
    /** Override called AE Title for this send. */
    readonly calledAETitle?: string | undefined;
    /** Override calling AE Title for this send. */
    readonly callingAETitle?: string | undefined;
}

/** Typed event map for DicomSend. */
interface DicomSendEventMap {
    SEND_COMPLETE: [SenderSendCompleteData];
    SEND_FAILED: [SenderSendFailedData];
    HEALTH_CHANGED: [SenderHealthChangedData];
    BUCKET_FLUSHED: [SenderBucketFlushedData];
    error: [{ readonly error: Error; readonly files?: readonly string[] | undefined }];
}

// ---------------------------------------------------------------------------
// Zod validation schema
// ---------------------------------------------------------------------------

const DicomSendOptionsSchema = z
    .object({
        host: z.string().min(1),
        port: z.number().int().min(1).max(65535),
        calledAETitle: z.string().min(1).max(16).refine(isValidAETitle, { message: 'AE Title contains invalid characters' }).optional(),
        callingAETitle: z.string().min(1).max(16).refine(isValidAETitle, { message: 'AE Title contains invalid characters' }).optional(),
        mode: z.enum(['single', 'multiple', 'bucket']).optional(),
        maxAssociations: z.number().int().min(1).max(MAX_ASSOCIATIONS_LIMIT).optional(),
        maxQueueLength: z.number().int().min(1).optional(),
        timeoutMs: z.number().int().positive().optional(),
        maxRetries: z.number().int().min(0).optional(),
        retryDelayMs: z.number().int().min(0).optional(),
        bucketFlushMs: z.number().int().positive().optional(),
        maxBucketSize: z.number().int().min(1).optional(),
        maxPduReceive: z.number().int().min(4096).max(131072).optional(),
        maxPduSend: z.number().int().min(4096).max(131072).optional(),
        associationTimeout: z.number().int().positive().optional(),
        acseTimeout: z.number().int().positive().optional(),
        dimseTimeout: z.number().int().positive().optional(),
        noHostnameLookup: z.boolean().optional(),
        verbosity: z.enum(['verbose', 'debug']).optional(),
        noHalt: z.boolean().optional(),
        noIllegalProposal: z.boolean().optional(),
        decompress: z.enum(['never', 'lossless', 'lossy']).optional(),
        multiAssociations: z.boolean().optional(),
        noUidChecks: z.boolean().optional(),
        signal: z.instanceof(AbortSignal).optional(),
    })
    .strict();

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** dcmsend-specific parameters that vary per send. */
interface DcmsendParams {
    readonly calledAETitle: string | undefined;
    readonly callingAETitle: string | undefined;
}

// ---------------------------------------------------------------------------
// Executor factory
// ---------------------------------------------------------------------------

/** Creates a SendExecutor that calls dcmsend with the instance-level options. */
function createDcmsendExecutor(options: DicomSendOptions): SendExecutor<DcmsendParams> {
    return async (files, timeoutMs, params, signal) => {
        const result = await dcmsend({
            host: options.host,
            port: options.port,
            files: [...files],
            calledAETitle: params.calledAETitle ?? options.calledAETitle,
            callingAETitle: params.callingAETitle ?? options.callingAETitle,
            maxPduReceive: options.maxPduReceive,
            maxPduSend: options.maxPduSend,
            associationTimeout: options.associationTimeout,
            acseTimeout: options.acseTimeout,
            dimseTimeout: options.dimseTimeout,
            noHostnameLookup: options.noHostnameLookup,
            verbosity: options.verbosity,
            noHalt: options.noHalt,
            noIllegalProposal: options.noIllegalProposal,
            decompress: options.decompress,
            multiAssociations: options.multiAssociations,
            noUidChecks: options.noUidChecks,
            timeoutMs,
            signal,
        });
        if (!result.ok) return err(result.error);
        return ok({ stdout: result.value.stdout, stderr: result.value.stderr });
    };
}

// ---------------------------------------------------------------------------
// Config resolver
// ---------------------------------------------------------------------------

/** Resolves user options into engine configuration values. */
function resolveConfig(options: DicomSendOptions): {
    mode: 'single' | 'multiple' | 'bucket';
    configuredMaxAssociations: number;
    maxQueueLength: number;
    defaultTimeoutMs: number;
    defaultMaxRetries: number;
    retryDelayMs: number;
    bucketFlushMs: number;
    maxBucketSize: number;
} {
    const mode = options.mode ?? 'multiple';
    const rawMax = options.maxAssociations ?? DEFAULT_MAX_ASSOCIATIONS;
    return {
        mode,
        configuredMaxAssociations: mode === 'single' ? 1 : rawMax,
        maxQueueLength: options.maxQueueLength ?? DEFAULT_MAX_QUEUE_LENGTH,
        defaultTimeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        defaultMaxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
        retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
        bucketFlushMs: options.bucketFlushMs ?? DEFAULT_BUCKET_FLUSH_MS,
        maxBucketSize: options.maxBucketSize ?? DEFAULT_MAX_BUCKET_SIZE,
    };
}

// ---------------------------------------------------------------------------
// DicomSend class
// ---------------------------------------------------------------------------

/**
 * High-throughput DICOM sender wrapping the `dcmsend` binary.
 *
 * Unlike {@link DicomSender} (which uses `storescu`), `DicomSend` uses
 * `dcmsend` which automatically proposes each file's native transfer
 * syntax. This avoids the need for commercial codec licenses when
 * sending compressed DICOM data (e.g., JPEG 2000).
 *
 * Supports the same three sending modes as DicomSender:
 * - **single**: One association at a time (FIFO queue).
 * - **multiple**: Up to N concurrent associations.
 * - **bucket**: Accumulates files into buckets, each flushed as one association.
 *
 * @example
 * ```ts
 * const result = DicomSend.create({
 *     host: '192.168.1.100',
 *     port: 104,
 *     calledAETitle: 'PACS',
 *     mode: 'multiple',
 *     maxAssociations: 8,
 * });
 * if (!result.ok) { console.error(result.error.message); return; }
 * const sender = result.value;
 *
 * sender.onSendComplete(data => console.log('Sent:', data.fileCount, 'files'));
 * sender.onSendFailed(data => console.error('Failed:', data.error.message));
 *
 * await sender.send(['/path/to/file1.dcm', '/path/to/file2.dcm']);
 * await sender.stop();
 * ```
 */
class DicomSend extends EventEmitter<DicomSendEventMap> {
    private readonly engine: SenderEngine<DcmsendParams>;
    private readonly defaultTimeoutMs: number;
    private readonly defaultMaxRetries: number;
    private readonly signal: AbortSignal | undefined;
    private abortHandler: (() => void) | undefined;

    private constructor(engine: SenderEngine<DcmsendParams>, cfg: ReturnType<typeof resolveConfig>, signal: AbortSignal | undefined) {
        super();
        this.setMaxListeners(20);
        this.on('error', () => {
            /* prevent Node.js uncaught exception on unhandled 'error' */
        });
        this.engine = engine;
        this.defaultTimeoutMs = cfg.defaultTimeoutMs;
        this.defaultMaxRetries = cfg.defaultMaxRetries;
        this.signal = signal;

        if (signal !== undefined) {
            this.wireAbortSignal(signal);
        }
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Creates a new DicomSend instance.
     *
     * @param options - Configuration options
     * @returns A Result containing the instance or a validation error
     */
    static create(options: DicomSendOptions): Result<DicomSend> {
        const validation = DicomSendOptionsSchema.safeParse(options);
        if (!validation.success) {
            return err(createValidationError('DicomSend', validation.error));
        }

        const cfg = resolveConfig(options);
        const senderRef: { current: DicomSend | undefined } = { current: undefined };
        const engine = new SenderEngine<DcmsendParams>({
            ...cfg,
            executor: createDcmsendExecutor(options),
            signal: options.signal,
            senderName: 'DicomSend',
            emitters: {
                emitSendComplete: (data): void => {
                    senderRef.current!.emit('SEND_COMPLETE', data);
                },
                emitSendFailed: (data): void => {
                    senderRef.current!.emit('SEND_FAILED', data);
                },
                emitHealthChanged: (data): void => {
                    senderRef.current!.emit('HEALTH_CHANGED', data);
                },
                emitBucketFlushed: (data): void => {
                    senderRef.current!.emit('BUCKET_FLUSHED', data);
                },
            },
        });
        const sender = new DicomSend(engine, cfg, options.signal);
        senderRef.current = sender;
        return ok(sender);
    }

    /**
     * Sends one or more DICOM files to the remote endpoint.
     *
     * In single/multiple mode, files are sent as one dcmsend call.
     * In bucket mode, files are accumulated into a bucket and flushed
     * when the bucket reaches maxBucketSize or the flush timer fires.
     *
     * @param files - One or more DICOM file paths
     * @param options - Per-send overrides
     * @returns A Result containing the send result or an error
     */
    send(files: readonly string[], options?: DcmsendSendOptions): Promise<Result<SendResult>> {
        const params: DcmsendParams = {
            calledAETitle: options?.calledAETitle,
            callingAETitle: options?.callingAETitle,
        };
        const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
        const maxRetries = options?.maxRetries ?? this.defaultMaxRetries;
        return this.engine.send(files, timeoutMs, maxRetries, params);
    }

    /**
     * Flushes the current bucket immediately (bucket mode only).
     * In single/multiple mode this is a no-op.
     */
    flush(): void {
        this.engine.flush();
    }

    /**
     * Gracefully stops the sender. Rejects all queued items and
     * waits for active associations to complete.
     */
    async stop(): Promise<void> {
        if (this.signal !== undefined && this.abortHandler !== undefined) {
            this.signal.removeEventListener('abort', this.abortHandler);
        }
        await this.engine.stop();
    }

    /** Current sender status. */
    get status(): SenderStatus {
        return this.engine.status;
    }

    // -----------------------------------------------------------------------
    // Typed event listener convenience methods
    // -----------------------------------------------------------------------

    /**
     * Registers a typed listener for a DicomSend-specific event.
     *
     * @param event - The event name from DicomSendEventMap
     * @param listener - Callback receiving typed event data
     * @returns this for chaining
     */
    onEvent<K extends keyof DicomSendEventMap>(event: K, listener: (...args: DicomSendEventMap[K]) => void): this {
        return this.on(event, listener as never);
    }

    /**
     * Registers a listener for successful sends.
     *
     * @param listener - Callback receiving send complete data
     * @returns this for chaining
     */
    onSendComplete(listener: (data: SenderSendCompleteData) => void): this {
        return this.on('SEND_COMPLETE', listener);
    }

    /**
     * Registers a listener for failed sends.
     *
     * @param listener - Callback receiving send failed data
     * @returns this for chaining
     */
    onSendFailed(listener: (data: SenderSendFailedData) => void): this {
        return this.on('SEND_FAILED', listener);
    }

    /**
     * Registers a listener for health state changes.
     *
     * @param listener - Callback receiving health change data
     * @returns this for chaining
     */
    onHealthChanged(listener: (data: SenderHealthChangedData) => void): this {
        return this.on('HEALTH_CHANGED', listener);
    }

    /**
     * Registers a listener for bucket flushes (bucket mode only).
     *
     * @param listener - Callback receiving bucket flush data
     * @returns this for chaining
     */
    onBucketFlushed(listener: (data: SenderBucketFlushedData) => void): this {
        return this.on('BUCKET_FLUSHED', listener);
    }

    // -----------------------------------------------------------------------
    // Abort signal
    // -----------------------------------------------------------------------

    /** Wires an AbortSignal to stop the sender. */
    private wireAbortSignal(signal: AbortSignal): void {
        /* v8 ignore next 4 */
        if (signal.aborted) {
            void this.stop();
            return;
        }
        this.abortHandler = (): void => {
            void this.stop();
        };
        signal.addEventListener('abort', this.abortHandler, { once: true });
    }
}

export { DicomSend };
export type { DicomSendOptions, DcmsendSendOptions, DicomSendEventMap };
