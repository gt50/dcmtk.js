/**
 * Core sender engine with queuing, bucketing, and backpressure.
 *
 * Extracted from DicomSender to allow reuse by both DicomSender (storescu)
 * and DicomSend (dcmsend) wrappers.
 *
 * @module senders/SenderEngine
 * @internal Not exported from the public API.
 */

import type { Result } from '../types';
import { ok, err, assertUnreachable } from '../types';
import { SenderHealth } from './types';
import type {
    SendResult,
    SenderStatus,
    SenderHealthValue,
    SenderSendCompleteData,
    SenderSendFailedData,
    SenderHealthChangedData,
    SenderBucketFlushedData,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Consecutive failures needed to transition HEALTHY → DEGRADED. */
const DEGRADE_THRESHOLD = 3;
/** Consecutive failures needed to transition → DOWN. */
const DOWN_THRESHOLD = 10;
/** Consecutive successes needed to recover from degraded/down state. */
const RECOVERY_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Function that executes the underlying binary (storescu or dcmsend). */
type SendExecutor<TParams> = (
    files: readonly string[],
    timeoutMs: number,
    binaryParams: TParams,
    signal: AbortSignal | undefined
) => Promise<Result<{ stdout: string; stderr: string }>>;

/** Event emit callbacks passed from the wrapper class. */
interface EngineEmitters {
    readonly emitSendComplete: (data: SenderSendCompleteData) => void;
    readonly emitSendFailed: (data: SenderSendFailedData) => void;
    readonly emitHealthChanged: (data: SenderHealthChangedData) => void;
    readonly emitBucketFlushed: (data: SenderBucketFlushedData) => void;
}

/** Configuration for the sender engine. */
interface EngineConfig<TParams> {
    readonly mode: 'single' | 'multiple' | 'bucket';
    readonly configuredMaxAssociations: number;
    readonly maxQueueLength: number;
    readonly defaultTimeoutMs: number;
    readonly defaultMaxRetries: number;
    readonly retryDelayMs: number;
    readonly bucketFlushMs: number;
    readonly maxBucketSize: number;
    readonly executor: SendExecutor<TParams>;
    readonly signal: AbortSignal | undefined;
    readonly emitters: EngineEmitters;
    readonly senderName: string;
}

/** Resolve callback for a queued send. */
interface QueueEntry<TParams> {
    readonly files: readonly string[];
    readonly timeoutMs: number;
    readonly maxRetries: number;
    readonly binaryParams: TParams;
    readonly resolve: (result: Result<SendResult>) => void;
}

/** A bucket entry associates files with the promise callbacks of all senders who contributed. */
interface BucketEntry<TParams> {
    readonly files: readonly string[];
    readonly resolve: (result: Result<SendResult>) => void;
    readonly timeoutMs: number;
    readonly maxRetries: number;
    readonly binaryParams: TParams;
}

/** Output captured from the last binary call in an attempt loop. */
interface BinaryOutput {
    readonly stdout: string;
    readonly stderr: string;
}

/** Result of attemptSend: undefined on success (already handled), or error + output on failure. */
interface AttemptFailure {
    readonly error: Error;
    readonly output: BinaryOutput;
}

// ---------------------------------------------------------------------------
// SenderEngine class
// ---------------------------------------------------------------------------

/**
 * Core sender engine with queuing, bucketing, and adaptive backpressure.
 *
 * @internal Not part of the public API. Used by DicomSender and DicomSend.
 */
class SenderEngine<TParams> {
    private readonly config: EngineConfig<TParams>;

    // Queue and concurrency state
    private readonly queue: QueueEntry<TParams>[] = [];
    private activeAssociations = 0;
    private isStopped = false;

    // Backpressure state
    private health: SenderHealthValue = SenderHealth.HEALTHY;
    private effectiveMaxAssociations: number;
    private consecutiveFailures = 0;
    private consecutiveSuccesses = 0;

    // Bucket state (bucket mode only)
    private currentBucket: BucketEntry<TParams>[] = [];
    private bucketTimer: ReturnType<typeof setTimeout> | undefined;

    // Abort wiring: stopController fires on stop(); combinedSignal also fires
    // when the externally provided config.signal aborts. Passed into the
    // executor and into delayInterruptible so stop() unblocks promptly.
    private readonly stopController = new AbortController();
    private readonly combinedSignal: AbortSignal;

    constructor(config: EngineConfig<TParams>) {
        this.config = config;
        this.effectiveMaxAssociations = config.configuredMaxAssociations;
        this.combinedSignal = combineSignals(this.stopController.signal, config.signal);
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /** Sends files through the engine's queue/bucket system. */
    send(files: readonly string[], timeoutMs: number, maxRetries: number, binaryParams: TParams): Promise<Result<SendResult>> {
        if (this.isStopped) {
            return Promise.resolve(err(new Error(`${this.config.senderName}: sender is stopped`)));
        }
        if (files.length === 0) {
            return Promise.resolve(err(new Error(`${this.config.senderName}: no files provided`)));
        }

        return this.dispatchSend(files, timeoutMs, maxRetries, binaryParams);
    }

    /** Flushes the current bucket immediately (bucket mode only). */
    flush(): void {
        if (this.config.mode !== 'bucket') return;
        if (this.currentBucket.length === 0) return;
        this.clearBucketTimer();
        this.flushBucketInternal('timer');
    }

    /** Gracefully stops the engine. Rejects all queued items and waits for active associations. */
    async stop(): Promise<void> {
        if (this.isStopped) return;
        this.isStopped = true;

        // Abort first so any in-flight executor and any pending retry-delay
        // unblock immediately. Without this, stop() blocks on the executor's
        // own timeout and on retryDelayMs * (attempt+1).
        this.stopController.abort();

        this.clearBucketTimer();
        this.rejectBucket(`${this.config.senderName}: sender stopped`);
        this.rejectQueue(`${this.config.senderName}: sender stopped`);

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

    /** Whether the engine has been stopped. */
    get stopped(): boolean {
        return this.isStopped;
    }

    // -----------------------------------------------------------------------
    // Dispatch
    // -----------------------------------------------------------------------

    /** Dispatches a send to the appropriate mode handler. */
    private dispatchSend(files: readonly string[], timeoutMs: number, maxRetries: number, binaryParams: TParams): Promise<Result<SendResult>> {
        switch (this.config.mode) {
            case 'single':
            case 'multiple':
                return this.enqueueSend(files, timeoutMs, maxRetries, binaryParams);
            case 'bucket':
                return this.enqueueBucket(files, timeoutMs, maxRetries, binaryParams);
            default:
                assertUnreachable(this.config.mode);
        }
    }

    // -----------------------------------------------------------------------
    // Single/Multiple mode: queue-based dispatch
    // -----------------------------------------------------------------------

    /** Enqueues a send and dispatches immediately if capacity allows. */
    private enqueueSend(files: readonly string[], timeoutMs: number, maxRetries: number, binaryParams: TParams): Promise<Result<SendResult>> {
        return new Promise(resolve => {
            const totalQueued = this.queue.length + this.currentBucket.length;
            if (totalQueued >= this.config.maxQueueLength) {
                resolve(err(new Error(`${this.config.senderName}: queue full`)));
                return;
            }

            const entry: QueueEntry<TParams> = { files, timeoutMs, maxRetries, binaryParams, resolve };

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
    private enqueueBucket(files: readonly string[], timeoutMs: number, maxRetries: number, binaryParams: TParams): Promise<Result<SendResult>> {
        return new Promise(resolve => {
            const totalQueued = this.queue.length + this.currentBucket.length;
            if (totalQueued >= this.config.maxQueueLength) {
                resolve(err(new Error(`${this.config.senderName}: queue full`)));
                return;
            }

            this.currentBucket.push({ files, resolve, timeoutMs, maxRetries, binaryParams });

            const totalFiles = this.countBucketFiles();
            if (totalFiles >= this.config.maxBucketSize) {
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

    /** Merges bucket entries into a single QueueEntry. */
    private mergeBucketEntries(entries: readonly BucketEntry<TParams>[]): QueueEntry<TParams> {
        const allFiles: string[] = [];
        let timeoutMs = 0;
        let maxRetries = 0;
        for (let i = 0; i < entries.length; i++) {
            for (let j = 0; j < entries[i]!.files.length; j++) {
                allFiles.push(entries[i]!.files[j]!);
            }
            if (entries[i]!.timeoutMs > timeoutMs) timeoutMs = entries[i]!.timeoutMs;
            if (entries[i]!.maxRetries > maxRetries) maxRetries = entries[i]!.maxRetries;
        }
        return {
            files: allFiles,
            timeoutMs,
            maxRetries,
            binaryParams: entries[0]!.binaryParams,
            resolve: (result: Result<SendResult>): void => {
                for (let i = 0; i < entries.length; i++) {
                    entries[i]!.resolve(result);
                }
            },
        };
    }

    /** Flushes the current bucket: combines all files, dispatches as one send. */
    private flushBucketInternal(reason: 'timer' | 'maxSize'): void {
        if (this.currentBucket.length === 0) return;

        const entries = [...this.currentBucket];
        this.currentBucket = [];

        const bucketEntry = this.mergeBucketEntries(entries);
        this.config.emitters.emitBucketFlushed({ fileCount: bucketEntry.files.length, reason });

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
        }, this.config.bucketFlushMs);
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

    /** Executes a single queue entry: calls the binary with retry. */
    private async executeEntry(entry: QueueEntry<TParams>): Promise<void> {
        this.activeAssociations++;
        const startMs = Date.now();
        const maxAttempts = entry.maxRetries + 1;
        const failure = await this.attemptSend(entry, maxAttempts, startMs);

        if (failure === undefined) return; // success already handled

        this.activeAssociations--;
        this.recordFailure();
        this.config.emitters.emitSendFailed({
            files: entry.files,
            error: failure.error,
            attempts: maxAttempts,
            stdout: failure.output.stdout,
            stderr: failure.output.stderr,
        });
        entry.resolve(err(failure.error));
        this.drainQueue();
    }

    /** Attempts the binary call up to maxAttempts times. Returns undefined on success. */
    private async attemptSend(entry: QueueEntry<TParams>, maxAttempts: number, startMs: number): Promise<AttemptFailure | undefined> {
        let lastError: Error | undefined;
        const lastOutput: BinaryOutput = { stdout: '', stderr: '' };

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (this.isStopped) {
                return this.resolveStopped(entry);
            }

            const result = await this.config.executor(entry.files, entry.timeoutMs, entry.binaryParams, this.combinedSignal);

            if (result.ok) {
                this.handleSendSuccess(entry, startMs, result.value);
                return undefined;
            }

            // Executor may have aborted because stop() was called mid-flight;
            // surface that as "stopped" rather than as a generic failure.
            if (this.isStopped) {
                return this.resolveStopped(entry);
            }

            lastError = result.error;
            if (attempt < maxAttempts - 1) {
                await delayInterruptible(this.config.retryDelayMs * (attempt + 1), this.combinedSignal);
            }
        }

        return { error: lastError ?? new Error(`${this.config.senderName}: send failed`), output: lastOutput };
    }

    /** Resolves the entry as stopped and decrements activeAssociations. Used from attemptSend. */
    private resolveStopped(entry: QueueEntry<TParams>): undefined {
        this.activeAssociations--;
        entry.resolve(err(new Error(`${this.config.senderName}: sender stopped`)));
        return undefined;
    }

    /** Handles a successful send: updates state, emits event, resolves promise. */
    private handleSendSuccess(entry: QueueEntry<TParams>, startMs: number, output: BinaryOutput): void {
        this.activeAssociations--;
        const durationMs = Date.now() - startMs;
        this.recordSuccess();
        const data: SendResult = { files: entry.files, fileCount: entry.files.length, durationMs, stdout: output.stdout, stderr: output.stderr };
        this.config.emitters.emitSendComplete(data);
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
                this.health = SenderHealth.DEGRADED;
            } else {
                this.effectiveMaxAssociations = Math.min(this.effectiveMaxAssociations * 2, this.config.configuredMaxAssociations);
                if (this.effectiveMaxAssociations >= this.config.configuredMaxAssociations) {
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
            this.degradeHealth(previousHealth);
        }
    }

    /** Handles HEALTHY→DEGRADED or DEGRADED→DEGRADED transitions. */
    private degradeHealth(previousHealth: SenderHealthValue): void {
        if (this.health === SenderHealth.HEALTHY) {
            this.health = SenderHealth.DEGRADED;
            this.effectiveMaxAssociations = Math.max(1, Math.floor(this.config.configuredMaxAssociations / 2));
            this.emitHealthChanged(previousHealth);
        } else if (this.health === SenderHealth.DEGRADED) {
            const newMax = Math.max(1, Math.floor(this.effectiveMaxAssociations / 2));
            if (newMax !== this.effectiveMaxAssociations) {
                this.effectiveMaxAssociations = newMax;
                this.emitHealthChanged(previousHealth);
            }
        }
    }

    /** Emits a HEALTH_CHANGED event via the wrapper's emitter. */
    private emitHealthChanged(previousHealth: SenderHealthValue): void {
        this.config.emitters.emitHealthChanged({
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Promise-based delay that resolves on either timeout OR signal abort. */
function delayInterruptible(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
        const onAbort = (): void => {
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * Combines a primary AbortSignal with an optional external AbortSignal.
 * The returned signal aborts when either input aborts. Implemented manually
 * (rather than AbortSignal.any) to keep `engines.node >= 20` compatibility:
 * AbortSignal.any requires Node 20.3+.
 */
function combineSignals(primary: AbortSignal, external: AbortSignal | undefined): AbortSignal {
    if (external === undefined) return primary;
    if (primary.aborted) return primary;
    if (external.aborted) {
        const c = new AbortController();
        c.abort(external.reason);
        return c.signal;
    }
    const merged = new AbortController();
    const onPrimary = (): void => {
        merged.abort(primary.reason);
        external.removeEventListener('abort', onExternal);
    };
    const onExternal = (): void => {
        merged.abort(external.reason);
        primary.removeEventListener('abort', onPrimary);
    };
    primary.addEventListener('abort', onPrimary, { once: true });
    external.addEventListener('abort', onExternal, { once: true });
    return merged.signal;
}

export { SenderEngine };
export type { SendExecutor, EngineConfig, EngineEmitters };
