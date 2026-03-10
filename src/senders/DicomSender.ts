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
import { ok, err, assertUnreachable } from '../types';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import { isValidAETitle } from '../patterns';
import { createValidationError } from '../tools/_toolError';
import { storescu } from '../tools/storescu';
import { SenderHealth } from './types';
import type {
    DicomSenderOptions,
    SendOptions,
    SendResult,
    SenderStatus,
    SenderHealthValue,
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

/** Consecutive failures needed to transition HEALTHY → DEGRADED. */
const DEGRADE_THRESHOLD = 3;
/** Consecutive failures needed to transition → DOWN. */
const DOWN_THRESHOLD = 10;
/** Consecutive successes needed to recover from degraded/down state. */
const RECOVERY_THRESHOLD = 3;

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
        noUidChecks: z.boolean().optional(),
        verbosity: z.enum(['verbose', 'debug']).optional(),
        signal: z.instanceof(AbortSignal).optional(),
    })
    .strict();

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Resolve/reject callbacks for a queued send. */
interface QueueEntry {
    readonly files: readonly string[];
    readonly timeoutMs: number;
    readonly maxRetries: number;
    readonly calledAETitle: string | undefined;
    readonly callingAETitle: string | undefined;
    readonly resolve: (result: Result<SendResult>) => void;
}

/** A bucket entry associates files with the promise callbacks of all senders who contributed. */
interface BucketEntry {
    readonly files: readonly string[];
    readonly resolve: (result: Result<SendResult>) => void;
    readonly timeoutMs: number;
    readonly maxRetries: number;
    readonly calledAETitle: string | undefined;
    readonly callingAETitle: string | undefined;
}

/** Output captured from the last storescu call in an attempt loop. */
interface StorescuOutput {
    readonly stdout: string;
    readonly stderr: string;
}

/** Result of attemptSend: undefined on success (already handled), or error + output on failure. */
interface AttemptFailure {
    readonly error: Error;
    readonly output: StorescuOutput;
}

/** Internal parameters extracted from SendOptions for queue/bucket dispatch. */
interface SendParams {
    readonly timeoutMs: number;
    readonly maxRetries: number;
    readonly calledAETitle: string | undefined;
    readonly callingAETitle: string | undefined;
}

/** Resolved configuration with defaults applied. */
interface ResolvedConfig {
    readonly mode: 'single' | 'multiple' | 'bucket';
    readonly configuredMaxAssociations: number;
    readonly maxQueueLength: number;
    readonly defaultTimeoutMs: number;
    readonly defaultMaxRetries: number;
    readonly retryDelayMs: number;
    readonly bucketFlushMs: number;
    readonly maxBucketSize: number;
}

/** Resolves user options into concrete configuration. */
function resolveConfig(options: DicomSenderOptions): ResolvedConfig {
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
    private readonly options: DicomSenderOptions;
    private readonly mode: 'single' | 'multiple' | 'bucket';
    private readonly configuredMaxAssociations: number;
    private readonly maxQueueLength: number;
    private readonly defaultTimeoutMs: number;
    private readonly defaultMaxRetries: number;
    private readonly retryDelayMs: number;
    private readonly bucketFlushMs: number;
    private readonly maxBucketSize: number;

    // Queue and concurrency state
    private readonly queue: QueueEntry[] = [];
    private activeAssociations = 0;
    private isStopped = false;

    // Backpressure state
    private health: SenderHealthValue = SenderHealth.HEALTHY;
    private effectiveMaxAssociations: number;
    private consecutiveFailures = 0;
    private consecutiveSuccesses = 0;

    // Bucket state (bucket mode only)
    private currentBucket: BucketEntry[] = [];
    private bucketTimer: ReturnType<typeof setTimeout> | undefined;

    // AbortSignal
    private abortHandler: (() => void) | undefined;

    private constructor(options: DicomSenderOptions) {
        super();
        this.setMaxListeners(20);
        this.on('error', () => {
            /* prevent Node.js uncaught exception on unhandled 'error' */
        });
        this.options = options;
        const cfg = resolveConfig(options);
        this.mode = cfg.mode;
        this.configuredMaxAssociations = cfg.configuredMaxAssociations;
        this.effectiveMaxAssociations = cfg.configuredMaxAssociations;
        this.maxQueueLength = cfg.maxQueueLength;
        this.defaultTimeoutMs = cfg.defaultTimeoutMs;
        this.defaultMaxRetries = cfg.defaultMaxRetries;
        this.retryDelayMs = cfg.retryDelayMs;
        this.bucketFlushMs = cfg.bucketFlushMs;
        this.maxBucketSize = cfg.maxBucketSize;

        if (options.signal !== undefined) {
            this.wireAbortSignal(options.signal);
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
        return ok(new DicomSender(options));
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
        if (this.isStopped) {
            return Promise.resolve(err(new Error('DicomSender: sender is stopped')));
        }
        if (files.length === 0) {
            return Promise.resolve(err(new Error('DicomSender: no files provided')));
        }

        const params: SendParams = {
            timeoutMs: options?.timeoutMs ?? this.defaultTimeoutMs,
            maxRetries: options?.maxRetries ?? this.defaultMaxRetries,
            calledAETitle: options?.calledAETitle,
            callingAETitle: options?.callingAETitle,
        };

        return this.dispatchSend(files, params);
    }

    /** Dispatches a send to the appropriate mode handler. */
    private dispatchSend(files: readonly string[], params: SendParams): Promise<Result<SendResult>> {
        switch (this.mode) {
            case 'single':
            case 'multiple':
                return this.enqueueSend(files, params);
            case 'bucket':
                return this.enqueueBucket(files, params);
            default:
                assertUnreachable(this.mode);
        }
    }

    /**
     * Flushes the current bucket immediately (bucket mode only).
     * In single/multiple mode this is a no-op.
     */
    flush(): void {
        if (this.mode !== 'bucket') return;
        if (this.currentBucket.length === 0) return;
        this.clearBucketTimer();
        this.flushBucketInternal('timer');
    }

    /**
     * Gracefully stops the sender. Rejects all queued items and
     * waits for active associations to complete.
     */
    async stop(): Promise<void> {
        if (this.isStopped) return;
        this.isStopped = true;

        if (this.options.signal !== undefined && this.abortHandler !== undefined) {
            this.options.signal.removeEventListener('abort', this.abortHandler);
        }

        this.clearBucketTimer();
        this.rejectBucket('DicomSender: sender stopped');
        this.rejectQueue('DicomSender: sender stopped');

        await this.waitForActive();
    }

    /** Current sender status. */
    get status(): SenderStatus {
        return {
            health: this.health,
            activeAssociations: this.activeAssociations,
            effectiveMaxAssociations: this.effectiveMaxAssociations,
            queueLength: this.queue.length,
            consecutiveFailures: this.consecutiveFailures,
            consecutiveSuccesses: this.consecutiveSuccesses,
            stopped: this.isStopped,
        };
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
    // Single/Multiple mode: queue-based dispatch
    // -----------------------------------------------------------------------

    /** Enqueues a send and dispatches immediately if capacity allows. */
    private enqueueSend(files: readonly string[], params: SendParams): Promise<Result<SendResult>> {
        return new Promise(resolve => {
            const totalQueued = this.queue.length + this.currentBucket.length;
            if (totalQueued >= this.maxQueueLength) {
                resolve(err(new Error('DicomSender: queue full')));
                return;
            }

            const entry: QueueEntry = {
                files,
                timeoutMs: params.timeoutMs,
                maxRetries: params.maxRetries,
                calledAETitle: params.calledAETitle,
                callingAETitle: params.callingAETitle,
                resolve,
            };

            if (this.activeAssociations < this.effectiveMaxAssociations) {
                void this.executeEntry(entry);
            } else {
                this.queue.push(entry);
            }
        });
    }

    /** Drains queued entries up to available capacity. */
    private drainQueue(): void {
        while (this.queue.length > 0 && this.activeAssociations < this.effectiveMaxAssociations) {
            const entry = this.queue.shift();
            /* v8 ignore next */
            if (entry === undefined) break;
            void this.executeEntry(entry);
        }
    }

    // -----------------------------------------------------------------------
    // Bucket mode: accumulate-then-flush
    // -----------------------------------------------------------------------

    /** Adds files to the current bucket and triggers flush if full. */
    private enqueueBucket(files: readonly string[], params: SendParams): Promise<Result<SendResult>> {
        return new Promise(resolve => {
            const totalQueued = this.queue.length + this.currentBucket.length;
            if (totalQueued >= this.maxQueueLength) {
                resolve(err(new Error('DicomSender: queue full')));
                return;
            }

            const { timeoutMs, maxRetries, calledAETitle, callingAETitle } = params;
            this.currentBucket.push({ files, resolve, timeoutMs, maxRetries, calledAETitle, callingAETitle });

            const totalFiles = this.countBucketFiles();
            if (totalFiles >= this.maxBucketSize) {
                this.clearBucketTimer();
                void this.flushBucketInternal('maxSize');
            } else {
                this.resetBucketTimer();
            }
        });
    }

    /** Counts total files in the current bucket. */
    private countBucketFiles(): number {
        let count = 0;
        for (let i = 0; i < this.currentBucket.length; i++) {
            count += this.currentBucket[i]!.files.length;
        }
        return count;
    }

    /** Flushes the current bucket: combines all files, dispatches as one send. */
    private flushBucketInternal(reason: 'timer' | 'maxSize'): void {
        if (this.currentBucket.length === 0) return;

        const entries = [...this.currentBucket];
        this.currentBucket = [];

        const allFiles: string[] = [];
        for (let i = 0; i < entries.length; i++) {
            for (let j = 0; j < entries[i]!.files.length; j++) {
                allFiles.push(entries[i]!.files[j]!);
            }
        }

        // Use the max timeoutMs and maxRetries from all entries
        let timeoutMs = 0;
        let maxRetries = 0;
        for (let i = 0; i < entries.length; i++) {
            if (entries[i]!.timeoutMs > timeoutMs) timeoutMs = entries[i]!.timeoutMs;
            if (entries[i]!.maxRetries > maxRetries) maxRetries = entries[i]!.maxRetries;
        }

        this.emit('BUCKET_FLUSHED', { fileCount: allFiles.length, reason });

        const bucketEntry: QueueEntry = {
            files: allFiles,
            timeoutMs,
            maxRetries,
            calledAETitle: entries[0]?.calledAETitle,
            callingAETitle: entries[0]?.callingAETitle,
            resolve: (result: Result<SendResult>) => {
                for (let i = 0; i < entries.length; i++) {
                    entries[i]!.resolve(result);
                }
            },
        };

        if (this.activeAssociations < this.effectiveMaxAssociations) {
            void this.executeEntry(bucketEntry);
        } else {
            this.queue.push(bucketEntry);
        }
    }

    /** Resets the bucket flush timer. */
    private resetBucketTimer(): void {
        this.clearBucketTimer();
        this.bucketTimer = setTimeout(() => {
            this.bucketTimer = undefined;
            void this.flushBucketInternal('timer');
        }, this.bucketFlushMs);
    }

    /** Clears the bucket flush timer. */
    private clearBucketTimer(): void {
        if (this.bucketTimer !== undefined) {
            clearTimeout(this.bucketTimer);
            this.bucketTimer = undefined;
        }
    }

    // -----------------------------------------------------------------------
    // Core send execution with retry
    // -----------------------------------------------------------------------

    /** Executes a single queue entry: calls storescu with retry. */
    private async executeEntry(entry: QueueEntry): Promise<void> {
        this.activeAssociations++;
        const startMs = Date.now();
        const maxAttempts = entry.maxRetries + 1;
        const failure = await this.attemptSend(entry, maxAttempts, startMs);

        if (failure === undefined) return; // success already handled

        this.activeAssociations--;
        this.recordFailure();
        this.emit('SEND_FAILED', {
            files: entry.files,
            error: failure.error,
            attempts: maxAttempts,
            stdout: failure.output.stdout,
            stderr: failure.output.stderr,
        });
        entry.resolve(err(failure.error));
        this.drainQueue();
    }

    /** Attempts storescu up to maxAttempts times. Returns undefined on success, or failure info. */
    private async attemptSend(entry: QueueEntry, maxAttempts: number, startMs: number): Promise<AttemptFailure | undefined> {
        let lastError: Error | undefined;
        const lastOutput: StorescuOutput = { stdout: '', stderr: '' };

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (this.isStopped) {
                this.activeAssociations--;
                entry.resolve(err(new Error('DicomSender: sender stopped')));
                return undefined;
            }

            const result = await this.callStorescu(entry);

            if (result.ok) {
                this.handleSendSuccess(entry, startMs, result.value);
                return undefined;
            }

            lastError = result.error;
            if (attempt < maxAttempts - 1) {
                await delay(this.retryDelayMs * (attempt + 1));
            }
        }

        return { error: lastError ?? new Error('DicomSender: send failed'), output: lastOutput };
    }

    /** Calls storescu with the configured options. */
    private callStorescu(entry: QueueEntry): ReturnType<typeof storescu> {
        return storescu({
            host: this.options.host,
            port: this.options.port,
            files: [...entry.files],
            calledAETitle: entry.calledAETitle ?? this.options.calledAETitle,
            callingAETitle: entry.callingAETitle ?? this.options.callingAETitle,
            proposedTransferSyntax: this.options.proposedTransferSyntax,
            maxPduReceive: this.options.maxPduReceive,
            maxPduSend: this.options.maxPduSend,
            associationTimeout: this.options.associationTimeout,
            acseTimeout: this.options.acseTimeout,
            dimseTimeout: this.options.dimseTimeout,
            noHostnameLookup: this.options.noHostnameLookup,
            noUidChecks: this.options.noUidChecks,
            verbosity: this.options.verbosity,
            timeoutMs: entry.timeoutMs,
            signal: this.options.signal,
        });
    }

    /** Handles a successful send: updates state, emits event, resolves promise. */
    private handleSendSuccess(entry: QueueEntry, startMs: number, output: { stdout: string; stderr: string }): void {
        this.activeAssociations--;
        const durationMs = Date.now() - startMs;
        this.recordSuccess();
        const data = { files: entry.files, fileCount: entry.files.length, durationMs, stdout: output.stdout, stderr: output.stderr };
        this.emit('SEND_COMPLETE', data);
        entry.resolve(ok(data));
        this.drainQueue();
    }

    // -----------------------------------------------------------------------
    // Backpressure state machine
    // -----------------------------------------------------------------------

    /** Records a successful send and adjusts health upward if needed. */
    private recordSuccess(): void {
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses++;

        if (this.health === SenderHealth.HEALTHY) return;

        if (this.consecutiveSuccesses >= RECOVERY_THRESHOLD) {
            this.consecutiveSuccesses = 0;
            const previousHealth = this.health;

            if (this.health === SenderHealth.DOWN) {
                // DOWN → DEGRADED: effectiveMax stays at 1
                this.health = SenderHealth.DEGRADED;
            } else {
                // DEGRADED: double effectiveMax
                this.effectiveMaxAssociations = Math.min(this.effectiveMaxAssociations * 2, this.configuredMaxAssociations);
                if (this.effectiveMaxAssociations >= this.configuredMaxAssociations) {
                    this.health = SenderHealth.HEALTHY;
                }
            }

            this.emitHealthChanged(previousHealth);
            this.drainQueue();
        }
    }

    /** Records a failed send and adjusts health downward if needed. */
    private recordFailure(): void {
        this.consecutiveSuccesses = 0;
        this.consecutiveFailures++;

        const previousHealth = this.health;

        if (this.consecutiveFailures >= DOWN_THRESHOLD) {
            if (this.health !== SenderHealth.DOWN) {
                this.health = SenderHealth.DOWN;
                this.effectiveMaxAssociations = 1;
                this.emitHealthChanged(previousHealth);
            }
        } else if (this.consecutiveFailures >= DEGRADE_THRESHOLD && this.consecutiveFailures % DEGRADE_THRESHOLD === 0) {
            if (this.health === SenderHealth.HEALTHY) {
                this.health = SenderHealth.DEGRADED;
                this.effectiveMaxAssociations = Math.max(1, Math.floor(this.configuredMaxAssociations / 2));
                this.emitHealthChanged(previousHealth);
            } else if (this.health === SenderHealth.DEGRADED) {
                const newMax = Math.max(1, Math.floor(this.effectiveMaxAssociations / 2));
                if (newMax !== this.effectiveMaxAssociations) {
                    this.effectiveMaxAssociations = newMax;
                    this.emitHealthChanged(previousHealth);
                }
            }
        }
    }

    /** Emits a HEALTH_CHANGED event. */
    private emitHealthChanged(previousHealth: SenderHealthValue): void {
        this.emit('HEALTH_CHANGED', {
            previousHealth,
            newHealth: this.health,
            effectiveMaxAssociations: this.effectiveMaxAssociations,
            consecutiveFailures: this.consecutiveFailures,
        });
    }

    // -----------------------------------------------------------------------
    // Lifecycle helpers
    // -----------------------------------------------------------------------

    /** Rejects all queued entries with the given message. */
    private rejectQueue(message: string): void {
        while (this.queue.length > 0) {
            const entry = this.queue.shift();
            /* v8 ignore next */
            if (entry === undefined) break;
            entry.resolve(err(new Error(message)));
        }
    }

    /** Rejects all bucket entries with the given message. */
    private rejectBucket(message: string): void {
        while (this.currentBucket.length > 0) {
            const entry = this.currentBucket.shift();
            /* v8 ignore next */
            if (entry === undefined) break;
            entry.resolve(err(new Error(message)));
        }
    }

    /** Waits for all active associations to complete. */
    private waitForActive(): Promise<void> {
        if (this.activeAssociations === 0) return Promise.resolve();
        return new Promise(resolve => {
            const check = (): void => {
                if (this.activeAssociations === 0) {
                    resolve();
                } else {
                    setTimeout(check, 50);
                }
            };
            check();
        });
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

/** Promise-based delay. */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

export { DicomSender };
