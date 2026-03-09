/**
 * Type definitions for the DicomSender module.
 *
 * Follows the project conventions: `as const` objects with union types
 * (no traditional enums), readonly interfaces, and Result pattern.
 *
 * @module senders/types
 */

import type { ProposedTransferSyntaxValue } from '../tools/storescu';

// ---------------------------------------------------------------------------
// Sending mode
// ---------------------------------------------------------------------------

/** Sending mode for the DicomSender. */
const SenderMode = {
    /** One association at a time, queued FIFO. */
    SINGLE: 'single',
    /** Up to N concurrent associations, each send() gets its own. */
    MULTIPLE: 'multiple',
    /** Files accumulated into buckets, each bucket = one association. */
    BUCKET: 'bucket',
} as const;

type SenderModeValue = (typeof SenderMode)[keyof typeof SenderMode];

// ---------------------------------------------------------------------------
// Health state
// ---------------------------------------------------------------------------

/** Health state of the sender's backpressure algorithm. */
const SenderHealth = {
    /** All associations succeeding normally. */
    HEALTHY: 'healthy',
    /** Recent failures detected; effective concurrency reduced. */
    DEGRADED: 'degraded',
    /** Remote endpoint appears down; minimal concurrency. */
    DOWN: 'down',
} as const;

type SenderHealthValue = (typeof SenderHealth)[keyof typeof SenderHealth];

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for creating a DicomSender instance. */
interface DicomSenderOptions {
    /** Remote host or IP address (required). */
    readonly host: string;
    /** Remote port number, 1-65535 (required). */
    readonly port: number;
    /** Called AE Title of the remote SCP (max 16 chars). */
    readonly calledAETitle?: string | undefined;
    /** Calling AE Title of the local SCU (max 16 chars). */
    readonly callingAETitle?: string | undefined;
    /** Sending mode. Defaults to 'multiple'. */
    readonly mode?: SenderModeValue | undefined;
    /** Maximum concurrent storescu associations. Defaults to 4 (forced to 1 in single mode). */
    readonly maxAssociations?: number | undefined;
    /** Proposed transfer syntax for associations. */
    readonly proposedTransferSyntax?: ProposedTransferSyntaxValue | undefined;
    /** Maximum queued send requests before rejecting. Defaults to 1000. */
    readonly maxQueueLength?: number | undefined;
    /** Per-storescu timeout in milliseconds. Defaults to 30000. */
    readonly timeoutMs?: number | undefined;
    /** Maximum retry attempts per send (0 = no retry). Defaults to 3. */
    readonly maxRetries?: number | undefined;
    /** Base retry delay in milliseconds. Defaults to 1000. */
    readonly retryDelayMs?: number | undefined;
    /** Bucket flush timeout in milliseconds (bucket mode only). Defaults to 5000. */
    readonly bucketFlushMs?: number | undefined;
    /** Maximum files per bucket before auto-flush (bucket mode only). Defaults to 50. */
    readonly maxBucketSize?: number | undefined;
    /** Maximum PDU receive size (passed through to storescu `--max-pdu`). */
    readonly maxPduReceive?: number | undefined;
    /** Maximum PDU send size (passed through to storescu `--max-send-pdu`). */
    readonly maxPduSend?: number | undefined;
    /** Association timeout in seconds (passed through to storescu `-to`). */
    readonly associationTimeout?: number | undefined;
    /** ACSE timeout in seconds (passed through to storescu `-ta`). */
    readonly acseTimeout?: number | undefined;
    /** DIMSE timeout in seconds (passed through to storescu `-td`). */
    readonly dimseTimeout?: number | undefined;
    /** Disable DNS hostname lookup (passed through to storescu `-nh`). Useful in containerized environments. */
    readonly noHostnameLookup?: boolean | undefined;
    /** Disable UID validity checking (passed through to storescu `--no-uid-checks`). */
    readonly noUidChecks?: boolean | undefined;
    /** Verbosity level for diagnostic output. `'verbose'` maps to `-v`, `'debug'` maps to `-d`. */
    readonly verbosity?: 'verbose' | 'debug' | undefined;
    /** AbortSignal for external cancellation. */
    readonly signal?: AbortSignal | undefined;
}

/** Per-send options that can override instance defaults. */
interface SendOptions {
    /** Override per-storescu timeout for this send. */
    readonly timeoutMs?: number | undefined;
    /** Override max retries for this send. */
    readonly maxRetries?: number | undefined;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Result of a successful send operation. */
interface SendResult {
    /** Files that were sent. */
    readonly files: readonly string[];
    /** Number of files sent. */
    readonly fileCount: number;
    /** Total send duration in milliseconds. */
    readonly durationMs: number;
}

/** Snapshot of the sender's current state. */
interface SenderStatus {
    /** Current health state. */
    readonly health: SenderHealthValue;
    /** Number of active storescu associations. */
    readonly activeAssociations: number;
    /** Current effective max associations (adjusted by backpressure). */
    readonly effectiveMaxAssociations: number;
    /** Number of queued send requests. */
    readonly queueLength: number;
    /** Total consecutive failures. */
    readonly consecutiveFailures: number;
    /** Total consecutive successes. */
    readonly consecutiveSuccesses: number;
    /** Whether the sender is stopped. */
    readonly stopped: boolean;
}

// ---------------------------------------------------------------------------
// Event data
// ---------------------------------------------------------------------------

/** Data emitted with SEND_COMPLETE events. */
interface SenderSendCompleteData {
    /** Files that were sent. */
    readonly files: readonly string[];
    /** Number of files sent. */
    readonly fileCount: number;
    /** Total send duration in milliseconds. */
    readonly durationMs: number;
}

/** Data emitted with SEND_FAILED events. */
interface SenderSendFailedData {
    /** Files that failed to send. */
    readonly files: readonly string[];
    /** The error that caused the failure. */
    readonly error: Error;
    /** Number of attempts made. */
    readonly attempts: number;
}

/** Data emitted with HEALTH_CHANGED events. */
interface SenderHealthChangedData {
    /** Previous health state. */
    readonly previousHealth: SenderHealthValue;
    /** New health state. */
    readonly newHealth: SenderHealthValue;
    /** Current effective max associations. */
    readonly effectiveMaxAssociations: number;
    /** Current consecutive failures count. */
    readonly consecutiveFailures: number;
}

/** Data emitted with BUCKET_FLUSHED events. */
interface SenderBucketFlushedData {
    /** Number of files in the flushed bucket. */
    readonly fileCount: number;
    /** Reason for the flush. */
    readonly reason: 'timer' | 'maxSize';
}

/** Data emitted with error events. */
interface SenderErrorData {
    /** The error that occurred. */
    readonly error: Error;
    /** Files involved, if applicable. */
    readonly files?: readonly string[] | undefined;
}

// ---------------------------------------------------------------------------
// Event map
// ---------------------------------------------------------------------------

/** Typed event map for DicomSender. */
interface DicomSenderEventMap {
    SEND_COMPLETE: [SenderSendCompleteData];
    SEND_FAILED: [SenderSendFailedData];
    HEALTH_CHANGED: [SenderHealthChangedData];
    BUCKET_FLUSHED: [SenderBucketFlushedData];
    error: [SenderErrorData];
}

export { SenderMode, SenderHealth };
export type {
    SenderModeValue,
    SenderHealthValue,
    DicomSenderOptions,
    SendOptions,
    SendResult,
    SenderStatus,
    SenderSendCompleteData,
    SenderSendFailedData,
    SenderHealthChangedData,
    SenderBucketFlushedData,
    SenderErrorData,
    DicomSenderEventMap,
};
