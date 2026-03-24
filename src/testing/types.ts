/**
 * Types for the DicomHammer load testing tool.
 *
 * @module testing/types
 */

import type { TagModification } from '../tools/dcmodify';

// ---------------------------------------------------------------------------
// Phase constant
// ---------------------------------------------------------------------------

/** Phases of a DicomHammer run. */
const HammerPhase = {
    /** File generation phase (copy + modify). */
    GENERATE: 'generate',
    /** File sending phase (dcmsend). */
    SEND: 'send',
} as const;

type HammerPhaseValue = (typeof HammerPhase)[keyof typeof HammerPhase];

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for {@link DicomHammer.create}. */
interface DicomHammerOptions {
    /** Path to the template DICOM file to copy and modify. */
    readonly sourceFile: string;
    /** Target SCP hostname or IP. */
    readonly host: string;
    /** Target SCP port (1-65535). */
    readonly port: number;
    /** Calling AE title. Defaults to `'HAMMER'`. */
    readonly callingAETitle?: string | undefined;
    /** Called AE title. Defaults to `'ANY-SCP'`. */
    readonly calledAETitle?: string | undefined;
    /** Number of DICOM file copies to generate. Range 1-100000. Defaults to 100. */
    readonly fileCount?: number | undefined;
    /** Max parallel operations for both generate and send phases. Range 1-64. Defaults to 4. */
    readonly concurrency?: number | undefined;
    /** Delay in milliseconds between each send. 0 means flood. Defaults to 0. */
    readonly delayMs?: number | undefined;
    /** Institution Name tag value to stamp on each copy. */
    readonly institution?: string | undefined;
    /** Erase all private tags from generated copies. Defaults to false. */
    readonly erasePrivateTags?: boolean | undefined;
    /** Additional tag modifications to apply to each copy. */
    readonly modifications?: readonly TagModification[] | undefined;
    /** Per-send timeout in milliseconds. */
    readonly timeoutMs?: number | undefined;
    /** AbortSignal for cancellation. */
    readonly signal?: AbortSignal | undefined;
    /** Directory for generated files. Defaults to `os.tmpdir()`. */
    readonly outputDir?: string | undefined;
    /** Pass `--no-halt` to dcmsend (continue on errors). Defaults to true. */
    readonly noHalt?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Result of the file generation phase. */
interface GenerateResult {
    /** Paths to all generated DICOM files. */
    readonly files: readonly string[];
    /** Duration of file generation in milliseconds. */
    readonly durationMs: number;
    /** Directory containing generated files. */
    readonly outputDir: string;
}

/** A single send failure. */
interface HammerError {
    /** Path to the file that failed to send. */
    readonly file: string;
    /** The error that occurred. */
    readonly error: Error;
}

/** Result of the send phase. */
interface HammerSendResult {
    /** Number of successfully sent files. */
    readonly succeeded: number;
    /** Number of failed sends. */
    readonly failed: number;
    /** Total files attempted. */
    readonly totalFiles: number;
    /** Duration of send phase in milliseconds. */
    readonly durationMs: number;
    /** Throughput in files per second. */
    readonly filesPerSec: number;
    /** Throughput in bytes per second. */
    readonly bytesPerSec: number;
    /** Total bytes sent (succeeded files only). */
    readonly totalBytes: number;
    /** Details of each failed send. */
    readonly errors: readonly HammerError[];
}

/** Combined result of generate + send phases. */
interface HammerResult {
    /** Number of successfully sent files. */
    readonly succeeded: number;
    /** Number of failed sends. */
    readonly failed: number;
    /** Total files attempted. */
    readonly totalFiles: number;
    /** Total duration (generate + send) in milliseconds. */
    readonly durationMs: number;
    /** Duration of the generate phase in milliseconds. */
    readonly generateDurationMs: number;
    /** Duration of the send phase in milliseconds. */
    readonly sendDurationMs: number;
    /** Throughput in files per second (send phase only). */
    readonly filesPerSec: number;
    /** Throughput in bytes per second (send phase only). */
    readonly bytesPerSec: number;
    /** Total bytes sent (succeeded files only). */
    readonly totalBytes: number;
    /** Details of each failed send. */
    readonly errors: readonly HammerError[];
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Event map for DicomHammer typed events. */
interface DicomHammerEventMap {
    FILE_GENERATED: [{ readonly index: number; readonly total: number; readonly filePath: string }];
    SEND_COMPLETE: [{ readonly index: number; readonly total: number; readonly file: string; readonly durationMs: number }];
    SEND_FAILED: [{ readonly index: number; readonly total: number; readonly file: string; readonly error: Error }];
    PROGRESS: [{ readonly phase: HammerPhaseValue; readonly completed: number; readonly total: number; readonly percent: number }];
    RUN_COMPLETE: [HammerResult];
    error: [{ readonly error: Error }];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { HammerPhase };
export type { HammerPhaseValue, DicomHammerOptions, GenerateResult, HammerError, HammerSendResult, HammerResult, DicomHammerEventMap };
