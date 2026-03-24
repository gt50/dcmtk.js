/**
 * DICOM load testing tool.
 *
 * Generates N copies of a template DICOM file with unique UIDs, sends them
 * to a target SCP with configurable concurrency, and reports throughput.
 *
 * @module testing/DicomHammer
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, rm, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { Result } from '../types';
import { ok, err } from '../types';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import { batch } from '../utils/batch';
import { copyFileSafe } from '../dicom/_fileHelpers';
import { dcmodify } from '../tools/dcmodify';
import type { TagModification } from '../tools/dcmodify';
import { dcmsend } from '../tools/dcmsend';
import { createValidationError } from '../tools/_toolError';
import { isValidAETitle } from '../patterns';
import { HammerPhase } from './types';
import type { DicomHammerOptions, DicomHammerEventMap, GenerateResult, HammerSendResult, HammerResult, HammerError } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FILE_COUNT = 100;
const MAX_FILE_COUNT = 100_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 64;
const DEFAULT_CALLING_AE = 'HAMMER';
const DEFAULT_CALLED_AE = 'ANY-SCP';
const DICOM_UID_ROOT = '2.25.';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const DicomHammerOptionsSchema = z
    .object({
        sourceFile: z.string().min(1),
        host: z.string().min(1),
        port: z.number().int().min(1).max(65535),
        callingAETitle: z.string().min(1).max(16).refine(isValidAETitle, { message: 'AE Title contains invalid characters' }).optional(),
        calledAETitle: z.string().min(1).max(16).refine(isValidAETitle, { message: 'AE Title contains invalid characters' }).optional(),
        fileCount: z.number().int().min(1).max(MAX_FILE_COUNT).optional(),
        concurrency: z.number().int().min(1).max(MAX_CONCURRENCY).optional(),
        delayMs: z.number().int().min(0).optional(),
        institution: z.string().min(1).optional(),
        erasePrivateTags: z.boolean().optional(),
        modifications: z.array(z.object({ tag: z.string().min(1), value: z.string() })).optional(),
        timeoutMs: z.number().int().positive().optional(),
        signal: z.instanceof(AbortSignal).optional(),
        outputDir: z.string().min(1).optional(),
        noHalt: z.boolean().optional(),
    })
    .strict();

// ---------------------------------------------------------------------------
// Resolved options (defaults applied)
// ---------------------------------------------------------------------------

interface ResolvedOptions {
    readonly sourceFile: string;
    readonly host: string;
    readonly port: number;
    readonly callingAETitle: string;
    readonly calledAETitle: string;
    readonly fileCount: number;
    readonly concurrency: number;
    readonly delayMs: number;
    readonly institution: string | undefined;
    readonly erasePrivateTags: boolean;
    readonly modifications: readonly TagModification[];
    readonly timeoutMs: number;
    readonly signal: AbortSignal | undefined;
    readonly outputDir: string;
    readonly noHalt: boolean;
}

function resolveNetworkOptions(
    options: DicomHammerOptions
): Pick<ResolvedOptions, 'host' | 'port' | 'callingAETitle' | 'calledAETitle' | 'timeoutMs' | 'noHalt'> {
    return {
        host: options.host,
        port: options.port,
        callingAETitle: options.callingAETitle ?? DEFAULT_CALLING_AE,
        calledAETitle: options.calledAETitle ?? DEFAULT_CALLED_AE,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        noHalt: options.noHalt ?? true,
    };
}

function resolveOptions(options: DicomHammerOptions): ResolvedOptions {
    return {
        sourceFile: options.sourceFile,
        ...resolveNetworkOptions(options),
        fileCount: options.fileCount ?? DEFAULT_FILE_COUNT,
        concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
        delayMs: options.delayMs ?? 0,
        institution: options.institution,
        erasePrivateTags: options.erasePrivateTags ?? false,
        modifications: options.modifications ?? [],
        signal: options.signal,
        outputDir: options.outputDir ?? tmpdir(),
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generates a valid DICOM UID using the 2.25. root + UUID-derived decimal. */
function generateUid(): string {
    const hex = randomUUID().replace(/-/g, '');
    const decimal = BigInt('0x' + hex).toString(10);
    return DICOM_UID_ROOT + decimal;
}

/** Returns today's date in DICOM DA format (YYYYMMDD). */
function formatDate(): string {
    const d = new Date();
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return yyyy + mm + dd;
}

/** Builds the tag modifications for a single generated copy. */
function buildModifications(index: number, opts: ResolvedOptions): TagModification[] {
    const mods: TagModification[] = [
        { tag: '(0020,000D)', value: generateUid() },
        { tag: '(0020,000E)', value: generateUid() },
        { tag: '(0008,0018)', value: generateUid() },
        { tag: '(0008,0020)', value: formatDate() },
        { tag: '(0008,0050)', value: `HAMMER-${String(index + 1).padStart(6, '0')}` },
    ];
    if (opts.institution !== undefined) {
        mods.push({ tag: '(0008,0080)', value: opts.institution });
    }
    for (const mod of opts.modifications) {
        mods.push({ tag: mod.tag, value: mod.value });
    }
    return mods;
}

/** Computes throughput statistics from send results. */
function computeThroughput(succeeded: number, totalBytes: number, durationMs: number): { filesPerSec: number; bytesPerSec: number } {
    const durationSec = durationMs / 1000;
    return {
        filesPerSec: durationSec > 0 ? succeeded / durationSec : 0,
        bytesPerSec: durationSec > 0 ? totalBytes / durationSec : 0,
    };
}

/** Sleeps for the given number of milliseconds. */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

// ---------------------------------------------------------------------------
// DicomHammer class
// ---------------------------------------------------------------------------

/**
 * DICOM load testing tool.
 *
 * Generates modified copies of a template DICOM file and sends them to a
 * target SCP to stress test its capacity.
 *
 * @example
 * ```ts
 * const result = DicomHammer.create({
 *     sourceFile: '/path/to/template.dcm',
 *     host: '127.0.0.1',
 *     port: 8104,
 *     fileCount: 1000,
 *     concurrency: 8,
 * });
 * if (!result.ok) { console.error(result.error.message); return; }
 * const hammer = result.value;
 *
 * hammer.onProgress(data => console.log(`${data.phase}: ${data.completed}/${data.total}`));
 * const runResult = await hammer.run();
 * if (runResult.ok) console.log(`${runResult.value.filesPerSec} files/sec`);
 * await hammer.cleanup();
 * ```
 */
class DicomHammer extends EventEmitter<DicomHammerEventMap> {
    private readonly opts: ResolvedOptions;
    private generatedDir: string | undefined;
    private generatedFiles: readonly string[] = [];

    private constructor(options: ResolvedOptions) {
        super();
        this.opts = options;
        this.setMaxListeners(20);
    }

    // -----------------------------------------------------------------------
    // Factory
    // -----------------------------------------------------------------------

    /**
     * Creates a DicomHammer instance.
     *
     * @param options - Configuration for file generation and sending
     * @returns A Result containing the DicomHammer or a validation error
     */
    static create(options: DicomHammerOptions): Result<DicomHammer> {
        const validation = DicomHammerOptionsSchema.safeParse(options);
        if (!validation.success) {
            return err(createValidationError('DicomHammer', validation.error));
        }
        return ok(new DicomHammer(resolveOptions(options)));
    }

    // -----------------------------------------------------------------------
    // Generate phase
    // -----------------------------------------------------------------------

    /**
     * Generates modified copies of the source DICOM file.
     *
     * Each copy receives unique Study/Series/SOP Instance UIDs, a unique
     * accession number, and any custom modifications.
     */
    async generate(): Promise<Result<GenerateResult>> {
        const start = Date.now();
        const dir = join(this.opts.outputDir, `dcmtk-hammer-${Date.now()}`);

        try {
            await mkdir(dir, { recursive: true });
        } catch {
            return err(new Error(`Failed to create output directory: ${dir}`));
        }

        this.generatedDir = dir;
        const indices = Array.from({ length: this.opts.fileCount }, (_, i) => i);
        const total = this.opts.fileCount;
        let completedCount = 0;

        const result = await batch(
            indices,
            async (index): Promise<Result<string>> => {
                return this.generateOneFile(index, dir);
            },
            {
                concurrency: this.opts.concurrency,
                signal: this.opts.signal,
                onProgress: (_completed, _total, fileResult) => {
                    completedCount++;
                    if (fileResult.ok) {
                        this.emit('FILE_GENERATED', { index: completedCount - 1, total, filePath: fileResult.value });
                    }
                    this.emitProgress(HammerPhase.GENERATE, completedCount, total);
                },
            }
        );

        const files = result.results.filter((r): r is { ok: true; value: string } => r.ok).map(r => r.value);
        this.generatedFiles = files;

        if (files.length === 0) {
            return err(new Error(`All ${total} file generations failed`));
        }

        return ok({ files, durationMs: Date.now() - start, outputDir: dir });
    }

    /** Generates a single modified copy. Extracted for function size compliance. */
    private async generateOneFile(index: number, dir: string): Promise<Result<string>> {
        const padded = String(index + 1).padStart(6, '0');
        const dest = join(dir, `hammer_${padded}.dcm`);

        const copyResult = await copyFileSafe(this.opts.sourceFile, dest);
        if (!copyResult.ok) return err(copyResult.error);

        const modResult = await dcmodify(dest, {
            modifications: buildModifications(index, this.opts),
            erasePrivateTags: this.opts.erasePrivateTags || undefined,
            insertIfMissing: true,
            noBackup: true,
            timeoutMs: this.opts.timeoutMs,
            signal: this.opts.signal,
        });
        if (!modResult.ok) return err(modResult.error);

        return ok(dest);
    }

    // -----------------------------------------------------------------------
    // Send phase
    // -----------------------------------------------------------------------

    /**
     * Sends files to the target SCP.
     *
     * @param files - Files to send. Defaults to previously generated files.
     */
    async send(files?: readonly string[]): Promise<Result<HammerSendResult>> {
        const filesToSend = files ?? this.generatedFiles;
        if (filesToSend.length === 0) {
            return err(new Error('No files to send. Call generate() first or provide files.'));
        }

        const fileSize = await this.getFileSize(filesToSend[0]!);
        const start = Date.now();
        const total = filesToSend.length;
        const tracker = { errors: [] as HammerError[], completedCount: 0, succeeded: 0 };

        await batch([...filesToSend], async (file): Promise<Result<void>> => this.sendOneFile(file), {
            concurrency: this.opts.concurrency,
            signal: this.opts.signal,
            onProgress: (_c, _t, sendResult) => this.trackSendProgress(sendResult, filesToSend, total, tracker),
        });

        return ok(this.buildSendResult(tracker, total, fileSize, Date.now() - start));
    }

    /** Tracks a single send result for progress reporting. */
    private trackSendProgress(
        sendResult: Result<void>,
        files: readonly string[],
        total: number,
        tracker: { errors: HammerError[]; completedCount: number; succeeded: number }
    ): void {
        tracker.completedCount++;
        const file = files[tracker.completedCount - 1]!;
        if (sendResult.ok) {
            tracker.succeeded++;
            this.emit('SEND_COMPLETE', { index: tracker.completedCount - 1, total, file, durationMs: 0 });
        } else {
            tracker.errors.push({ file, error: sendResult.error });
            this.emit('SEND_FAILED', { index: tracker.completedCount - 1, total, file, error: sendResult.error });
        }
        this.emitProgress(HammerPhase.SEND, tracker.completedCount, total);
    }

    /** Assembles the final HammerSendResult. */
    private buildSendResult(
        tracker: { errors: readonly HammerError[]; succeeded: number },
        total: number,
        fileSize: number,
        durationMs: number
    ): HammerSendResult {
        const totalBytes = tracker.succeeded * fileSize;
        const throughput = computeThroughput(tracker.succeeded, totalBytes, durationMs);
        return {
            succeeded: tracker.succeeded,
            failed: tracker.errors.length,
            totalFiles: total,
            durationMs,
            filesPerSec: throughput.filesPerSec,
            bytesPerSec: throughput.bytesPerSec,
            totalBytes,
            errors: tracker.errors,
        };
    }

    /** Sends a single file, with optional delay. */
    private async sendOneFile(file: string): Promise<Result<void>> {
        if (this.opts.delayMs > 0) {
            await delay(this.opts.delayMs);
        }
        const result = await dcmsend({
            host: this.opts.host,
            port: this.opts.port,
            files: [file],
            callingAETitle: this.opts.callingAETitle,
            calledAETitle: this.opts.calledAETitle,
            noHalt: this.opts.noHalt || undefined,
            timeoutMs: this.opts.timeoutMs,
            signal: this.opts.signal,
        });
        if (!result.ok) return err(result.error);
        return ok(undefined);
    }

    /** Gets the file size in bytes, returning 0 on error. */
    private async getFileSize(filePath: string): Promise<number> {
        try {
            const s = await stat(filePath);
            return s.size;
        } catch {
            return 0;
        }
    }

    // -----------------------------------------------------------------------
    // Combined run
    // -----------------------------------------------------------------------

    /**
     * Generates files and sends them in one call.
     *
     * @returns Combined result with timing for both phases
     */
    async run(): Promise<Result<HammerResult>> {
        const genResult = await this.generate();
        if (!genResult.ok) return err(genResult.error);

        const sendResult = await this.send(genResult.value.files);
        if (!sendResult.ok) return err(sendResult.error);

        const result: HammerResult = {
            succeeded: sendResult.value.succeeded,
            failed: sendResult.value.failed,
            totalFiles: sendResult.value.totalFiles,
            durationMs: genResult.value.durationMs + sendResult.value.durationMs,
            generateDurationMs: genResult.value.durationMs,
            sendDurationMs: sendResult.value.durationMs,
            filesPerSec: sendResult.value.filesPerSec,
            bytesPerSec: sendResult.value.bytesPerSec,
            totalBytes: sendResult.value.totalBytes,
            errors: sendResult.value.errors,
        };

        this.emit('RUN_COMPLETE', result);
        return ok(result);
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    /** Removes all generated files and the output directory. */
    async cleanup(): Promise<Result<void>> {
        if (this.generatedDir === undefined) return ok(undefined);
        try {
            await rm(this.generatedDir, { recursive: true, force: true });
            this.generatedDir = undefined;
            this.generatedFiles = [];
            return ok(undefined);
        } catch {
            return err(new Error(`Failed to cleanup: ${this.generatedDir}`));
        }
    }

    // -----------------------------------------------------------------------
    // Event helpers
    // -----------------------------------------------------------------------

    /** Emits a PROGRESS event. */
    private emitProgress(phase: 'generate' | 'send', completed: number, total: number): void {
        this.emit('PROGRESS', { phase, completed, total, percent: Math.round((completed / total) * 100) });
    }

    /** Registers a listener for FILE_GENERATED events. */
    onFileGenerated(listener: (data: DicomHammerEventMap['FILE_GENERATED'][0]) => void): this {
        return this.on('FILE_GENERATED', listener);
    }

    /** Registers a listener for SEND_COMPLETE events. */
    onSendComplete(listener: (data: DicomHammerEventMap['SEND_COMPLETE'][0]) => void): this {
        return this.on('SEND_COMPLETE', listener);
    }

    /** Registers a listener for SEND_FAILED events. */
    onSendFailed(listener: (data: DicomHammerEventMap['SEND_FAILED'][0]) => void): this {
        return this.on('SEND_FAILED', listener);
    }

    /** Registers a listener for PROGRESS events. */
    onProgress(listener: (data: DicomHammerEventMap['PROGRESS'][0]) => void): this {
        return this.on('PROGRESS', listener);
    }

    /** Registers a listener for RUN_COMPLETE events. */
    onRunComplete(listener: (data: DicomHammerEventMap['RUN_COMPLETE'][0]) => void): this {
        return this.on('RUN_COMPLETE', listener);
    }
}

export { DicomHammer, generateUid };
