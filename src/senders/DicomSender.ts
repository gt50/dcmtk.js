/**
 * High-throughput DICOM sender with queuing, bucketing, and backpressure.
 *
 * Manages concurrent `storescu` calls with three sending modes
 * (single, multiple, bucket), automatic retry, and adaptive
 * backpressure to handle struggling remote endpoints.
 *
 * @module senders/DicomSender
 */

import { EventEmitter } from 'node:events';
import { z } from 'zod';
import type { Result } from '../types';
import { ok, err } from '../types';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import { isValidAETitle } from '../patterns';
import { ToolExecutionError, createValidationError } from '../tools/_toolError';
import { storescu, PROPOSED_TS_VALUES } from '../tools/storescu';
import type { ProposedTransferSyntaxValue } from '../tools/storescu';
import { SenderEngine } from './SenderEngine';
import type { SendExecutor } from './SenderEngine';
import type {
    DicomSenderOptions,
    SendOptions,
    SendResult,
    SenderStatus,
    SenderSendCompleteData,
    SenderSendFailedData,
    SenderHealthChangedData,
    SenderBucketFlushedData,
    DicomSenderEventMap,
} from './types';

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
// Zod validation schema
// ---------------------------------------------------------------------------

const DicomSenderOptionsSchema = z
    .object({
        host: z.string().min(1),
        port: z.number().int().min(1).max(65535),
        calledAETitle: z.string().min(1).max(16).refine(isValidAETitle, { message: 'AE Title contains invalid characters' }).optional(),
        callingAETitle: z.string().min(1).max(16).refine(isValidAETitle, { message: 'AE Title contains invalid characters' }).optional(),
        mode: z.enum(['single', 'multiple', 'bucket']).optional(),
        maxAssociations: z.number().int().min(1).max(MAX_ASSOCIATIONS_LIMIT).optional(),
        proposedTransferSyntax: z.union([z.enum(PROPOSED_TS_VALUES), z.array(z.enum(PROPOSED_TS_VALUES)).min(1)]).optional(),
        combineProposedTransferSyntaxes: z.boolean().optional(),
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
        required: z.boolean().optional(),
        signal: z.instanceof(AbortSignal).optional(),
    })
    .strict();

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** storescu-specific parameters that vary per send. */
interface StorescuParams {
    readonly calledAETitle: string | undefined;
    readonly callingAETitle: string | undefined;
    readonly required: boolean | undefined;
    readonly proposedTransferSyntax: ProposedTransferSyntaxValue | readonly ProposedTransferSyntaxValue[] | undefined;
    readonly combineProposedTransferSyntaxes: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Executor factory
// ---------------------------------------------------------------------------

/** Creates a SendExecutor that calls storescu with the instance-level options. */
function createStorescuExecutor(options: DicomSenderOptions): SendExecutor<StorescuParams> {
    return async (files, timeoutMs, params, signal) => {
        const result = await storescu({
            host: options.host,
            port: options.port,
            files: [...files],
            calledAETitle: params.calledAETitle ?? options.calledAETitle,
            callingAETitle: params.callingAETitle ?? options.callingAETitle,
            proposedTransferSyntax: params.proposedTransferSyntax ?? options.proposedTransferSyntax,
            combineProposedTransferSyntaxes: params.combineProposedTransferSyntaxes ?? options.combineProposedTransferSyntaxes,
            maxPduReceive: options.maxPduReceive,
            maxPduSend: options.maxPduSend,
            associationTimeout: options.associationTimeout,
            acseTimeout: options.acseTimeout,
            dimseTimeout: options.dimseTimeout,
            noHostnameLookup: options.noHostnameLookup,
            verbosity: options.verbosity,
            required: params.required ?? options.required,
            timeoutMs,
            signal,
        });
        if (!result.ok) {
            const e = result.error;
            const stdout = e instanceof ToolExecutionError ? e.stdout : '';
            const stderr = e instanceof ToolExecutionError ? e.stderr : '';
            return { stdout, stderr, error: e };
        }
        return { stdout: result.value.stdout, stderr: result.value.stderr };
    };
}

// ---------------------------------------------------------------------------
// Config resolver
// ---------------------------------------------------------------------------

/** Resolves user options into engine configuration values. */
function resolveConfig(options: DicomSenderOptions): {
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
// DicomSender class
// ---------------------------------------------------------------------------

/**
 * High-throughput DICOM sender with queuing, bucketing, and backpressure.
 *
 * Manages concurrent `storescu` calls with three sending modes:
 * - **single**: One association at a time (FIFO queue).
 * - **multiple**: Up to N concurrent associations.
 * - **bucket**: Accumulates files into buckets, each flushed as one association.
 *
 * @example
 * ```ts
 * const result = DicomSender.create({
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
class DicomSender extends EventEmitter<DicomSenderEventMap> {
    private readonly engine: SenderEngine<StorescuParams>;
    private readonly defaultTimeoutMs: number;
    private readonly defaultMaxRetries: number;
    private readonly signal: AbortSignal | undefined;
    private abortHandler: (() => void) | undefined;

    private constructor(engine: SenderEngine<StorescuParams>, cfg: ReturnType<typeof resolveConfig>, signal: AbortSignal | undefined) {
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
     * Creates a new DicomSender instance.
     *
     * @param options - Configuration options
     * @returns A Result containing the instance or a validation error
     */
    static create(options: DicomSenderOptions): Result<DicomSender> {
        const validation = DicomSenderOptionsSchema.safeParse(options);
        if (!validation.success) {
            return err(createValidationError('DicomSender', validation.error));
        }

        const cfg = resolveConfig(options);
        const senderRef: { current: DicomSender | undefined } = { current: undefined };
        const engine = new SenderEngine<StorescuParams>({
            ...cfg,
            executor: createStorescuExecutor(options),
            signal: options.signal,
            senderName: 'DicomSender',
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
        const sender = new DicomSender(engine, cfg, options.signal);
        senderRef.current = sender;
        return ok(sender);
    }

    /**
     * Sends one or more DICOM files to the remote endpoint.
     *
     * In single/multiple mode, files are sent as one storescu call.
     * In bucket mode, files are accumulated into a bucket and flushed
     * when the bucket reaches maxBucketSize or the flush timer fires.
     *
     * The returned promise resolves when the files are actually sent
     * (not just queued). Callers can await for confirmation or
     * fire-and-forget with `void sender.send(files)`.
     *
     * @param files - One or more DICOM file paths
     * @param options - Per-send overrides
     * @returns A Result containing the send result or an error
     */
    send(files: readonly string[], options?: SendOptions): Promise<Result<SendResult>> {
        const params = buildStorescuParams(options);
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
     * Registers a typed listener for a DicomSender-specific event.
     *
     * @param event - The event name from DicomSenderEventMap
     * @param listener - Callback receiving typed event data
     * @returns this for chaining
     */
    onEvent<K extends keyof DicomSenderEventMap>(event: K, listener: (...args: DicomSenderEventMap[K]) => void): this {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds StorescuParams from per-send options. */
function buildStorescuParams(options?: SendOptions): StorescuParams {
    return {
        calledAETitle: options?.calledAETitle,
        callingAETitle: options?.callingAETitle,
        required: options?.required,
        proposedTransferSyntax: options?.proposedTransferSyntax,
        combineProposedTransferSyntaxes: options?.combineProposedTransferSyntaxes,
    };
}

export { DicomSender };
