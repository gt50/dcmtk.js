/**
 * Pooled DICOM receiver with auto-scaling.
 *
 * Manages a pool of long-lived `Dcmrecv` workers behind a TCP proxy,
 * routing incoming connections to idle workers. Workers are reused
 * across associations — they are only stopped during scale-down or
 * shutdown.
 *
 * @module servers/DicomReceiver
 */

import * as net from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import type { Result } from '../types';
import { ok, err } from '../types';
import { isSafePath, isValidAETitle } from '../patterns';
import { createValidationError } from '../tools/_toolError';
import { ensureDirectory, moveFile, statFileSafe, removeDirSafe } from '../utils';
import { Dcmrecv } from './Dcmrecv';
import type { FilenameModeValue, StorageModeValue } from './Dcmrecv';
import type { AssociationCompleteData } from '../events/dcmrecv';
import { DicomInstance } from '../dicom';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MIN_POOL_SIZE = 2;
const DEFAULT_MAX_POOL_SIZE = 10;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const CONNECTION_RETRY_INTERVAL_MS = 500;
const MAX_CONNECTION_RETRIES = 200;
const MAX_OUTPUT_LINES_PER_ASSOCIATION = 500;

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Snapshot of the worker pool state. */
interface PoolStatus {
    /** Number of idle workers ready for connections. */
    readonly idle: number;
    /** Number of workers currently handling associations. */
    readonly busy: number;
    /** Total number of workers (idle + busy). */
    readonly total: number;
}

/** Data emitted with FILE_RECEIVED events. */
interface ReceiverFileData {
    readonly filePath: string;
    readonly fileSize: number;
    readonly associationId: string;
    readonly associationDir: string;
    readonly callingAE: string;
    readonly calledAE: string;
    readonly source: string;
    readonly instance: DicomInstance;
}

/** Data emitted with ASSOCIATION_COMPLETE events. */
interface ReceiverAssociationData {
    readonly associationId: string;
    readonly associationDir: string;
    readonly callingAE: string;
    readonly calledAE: string;
    readonly source: string;
    readonly files: readonly string[];
    readonly durationMs: number;
    readonly endReason: 'release' | 'abort';
    readonly totalBytes: number;
    readonly bytesPerSecond: number;
    readonly startAt: number;
    readonly endAt: number;
    /** Captured stdout/stderr lines from the worker during this association. */
    readonly output: readonly string[];
}

/** Data emitted with ASSOCIATION_RECEIVED events (bubbled from worker). */
interface PoolAssociationReceivedData {
    readonly associationId: string;
    readonly callingAE: string;
    readonly calledAE: string;
    readonly source: string;
}

/** Data emitted with C_STORE_REQUEST events (bubbled from worker). */
interface PoolCStoreRequestData {
    readonly associationId: string;
    readonly raw: string;
}

/** Data emitted with ECHO_REQUEST events (bubbled from worker). */
interface PoolEchoRequestData {
    readonly associationId: string;
}

/** Data emitted with REFUSING_ASSOCIATION events (bubbled from worker). */
interface PoolRefusingAssociationData {
    readonly reason: string;
}

/** Data emitted with error events. */
interface ReceiverErrorData {
    readonly error: Error;
    readonly filePath?: string;
    readonly associationId?: string;
    readonly associationDir?: string;
    readonly callingAE?: string;
    readonly calledAE?: string;
    readonly source?: string;
}

/** Typed event map for DicomReceiver. */
interface DicomReceiverEventMap {
    FILE_RECEIVED: [ReceiverFileData];
    ASSOCIATION_COMPLETE: [ReceiverAssociationData];
    ASSOCIATION_RECEIVED: [PoolAssociationReceivedData];
    C_STORE_REQUEST: [PoolCStoreRequestData];
    ECHO_REQUEST: [PoolEchoRequestData];
    REFUSING_ASSOCIATION: [PoolRefusingAssociationData];
    error: [ReceiverErrorData];
}

/** Options for creating a DicomReceiver instance. */
interface DicomReceiverOptions {
    /** External port to listen on (required). */
    readonly port: number;
    /** Root directory for association subdirectories (required). */
    readonly storageDir: string;
    /** Application Entity Title for workers. */
    readonly aeTitle?: string | undefined;
    /** Minimum number of idle workers to maintain. */
    readonly minPoolSize?: number | undefined;
    /** Maximum total workers allowed. */
    readonly maxPoolSize?: number | undefined;
    /** Timeout for waiting for an idle worker (milliseconds). */
    readonly connectionTimeoutMs?: number | undefined;
    /** Path to a dcmrecv association negotiation configuration file. */
    readonly configFile?: string | undefined;
    /** Profile name within the configuration file. */
    readonly configProfile?: string | undefined;
    /** ACSE timeout in seconds (passed through to Dcmrecv workers). */
    readonly acseTimeout?: number | undefined;
    /** DIMSE timeout in seconds (passed through to Dcmrecv workers). */
    readonly dimseTimeout?: number | undefined;
    /** Maximum PDU receive size (passed through to Dcmrecv workers). */
    readonly maxPdu?: number | undefined;
    /** Filename generation mode for received files (passed through to Dcmrecv workers). */
    readonly filenameMode?: FilenameModeValue | undefined;
    /** Extension appended to received filenames, e.g. `'.dcm'` (passed through to Dcmrecv workers). */
    readonly filenameExtension?: string | undefined;
    /** Storage mode for received files (passed through to Dcmrecv workers). */
    readonly storageMode?: StorageModeValue | undefined;
    /** AbortSignal for external cancellation. */
    readonly signal?: AbortSignal | undefined;
}

// ---------------------------------------------------------------------------
// Zod validation schema
// ---------------------------------------------------------------------------

const DicomReceiverOptionsSchema = z
    .object({
        port: z.number().int().min(0).max(65535),
        storageDir: z.string().min(1).refine(isSafePath, { message: 'path traversal detected in storageDir' }),
        aeTitle: z.string().min(1).max(16).refine(isValidAETitle, { message: 'AE Title contains invalid characters' }).optional(),
        minPoolSize: z.number().int().min(1).max(100).optional(),
        maxPoolSize: z.number().int().min(1).max(100).optional(),
        connectionTimeoutMs: z.number().int().positive().optional(),
        configFile: z.string().min(1).refine(isSafePath, { message: 'path traversal detected in configFile' }).optional(),
        configProfile: z.string().min(1).optional(),
        acseTimeout: z.number().int().positive().optional(),
        dimseTimeout: z.number().int().positive().optional(),
        maxPdu: z.number().int().min(4096).max(131072).optional(),
        filenameMode: z.enum(['default', 'unique', 'short-unique', 'system-time']).optional(),
        filenameExtension: z.string().min(1).optional(),
        storageMode: z.enum(['normal', 'bit-preserving', 'ignore']).optional(),
        signal: z.instanceof(AbortSignal).optional(),
    })
    .strict()
    .refine(data => (data.minPoolSize ?? DEFAULT_MIN_POOL_SIZE) <= (data.maxPoolSize ?? DEFAULT_MAX_POOL_SIZE), {
        message: 'minPoolSize must be <= maxPoolSize',
    });

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Frozen context for a single association, captured synchronously at connection time. */
interface AssociationContext {
    readonly associationId: string;
    readonly associationDir: string;
    readonly startAt: number;
}

// ---------------------------------------------------------------------------
// Internal Worker class
// ---------------------------------------------------------------------------

/** Encapsulates a single Dcmrecv worker and its per-association state. */
class Worker {
    readonly dcmrecv: Dcmrecv;
    readonly port: number;
    readonly tempDir: string;
    private _state: 'idle' | 'busy' = 'idle';
    private _context: AssociationContext | undefined;
    private readonly _pending = new Set<Promise<void>>();
    private readonly _files: string[] = [];
    private readonly _fileSizes: number[] = [];
    private readonly _outputLines: string[] = [];
    private _remoteSocket: net.Socket | undefined;
    private _workerSocket: net.Socket | undefined;

    constructor(dcmrecv: Dcmrecv, port: number, tempDir: string) {
        this.dcmrecv = dcmrecv;
        this.port = port;
        this.tempDir = tempDir;
    }

    /** Current worker state. */
    get state(): 'idle' | 'busy' {
        return this._state;
    }

    /** Active association context, or undefined when idle. */
    get context(): AssociationContext | undefined {
        return this._context;
    }

    /** Files moved to the association directory during the current association. */
    get files(): readonly string[] {
        return this._files;
    }

    /** Byte sizes parallel to files[], for transfer stats. */
    get fileSizes(): readonly number[] {
        return this._fileSizes;
    }

    /** Captured output lines during the current association. */
    get outputLines(): readonly string[] {
        return this._outputLines;
    }

    /** Marks the worker busy with a new association context. */
    beginAssociation(ctx: AssociationContext): void {
        this._state = 'busy';
        this._context = ctx;
        this._files.length = 0;
        this._fileSizes.length = 0;
        this._outputLines.length = 0;
        this._pending.clear();
    }

    /** Returns the worker to idle and clears all association state. */
    endAssociation(): void {
        this._state = 'idle';
        this._context = undefined;
        this._files.length = 0;
        this._fileSizes.length = 0;
        this._outputLines.length = 0;
        this._pending.clear();
        this._remoteSocket = undefined;
        this._workerSocket = undefined;
    }

    /** Tracks an in-flight file handling promise; auto-removes on completion. */
    trackFile(promise: Promise<void>): void {
        this._pending.add(promise);
        void promise.finally(() => {
            this._pending.delete(promise);
        });
    }

    /** Records a successfully received file path and its size. */
    recordFile(filePath: string, size: number): void {
        this._files.push(filePath);
        this._fileSizes.push(size);
    }

    /** Awaits all in-flight file handling promises. */
    async drainPendingFiles(): Promise<void> {
        if (this._pending.size > 0) {
            await Promise.all(this._pending);
        }
    }

    /** Appends a line to the output buffer, respecting the cap. */
    captureOutput(text: string): void {
        if (this._outputLines.length < MAX_OUTPUT_LINES_PER_ASSOCIATION) {
            this._outputLines.push(text);
        }
    }

    /** Stores the remote and worker sockets for later cleanup. */
    setSockets(remote: net.Socket, worker: net.Socket): void {
        this._remoteSocket = remote;
        this._workerSocket = worker;
    }

    /** Destroys both sockets if they exist and are not already destroyed. */
    destroySockets(): void {
        if (this._remoteSocket !== undefined && !this._remoteSocket.destroyed) {
            this._remoteSocket.destroy();
        }
        if (this._workerSocket !== undefined && !this._workerSocket.destroyed) {
            this._workerSocket.destroy();
        }
    }
}

// ---------------------------------------------------------------------------
// Port allocation helper
// ---------------------------------------------------------------------------

/** Allocates a free ephemeral port by binding to port 0. */
function allocatePort(): Promise<Result<number>> {
    return new Promise(resolve => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (addr === null || typeof addr === 'string') {
                server.close(() => resolve(err(new Error('Failed to allocate port'))));
                return;
            }
            const port = addr.port;
            server.close(() => resolve(ok(port)));
        });
        server.on('error', e => {
            resolve(err(new Error(`Port allocation failed: ${e.message}`)));
        });
    });
}

// ---------------------------------------------------------------------------
// Trivial helpers
// ---------------------------------------------------------------------------

/** Sums an array of numbers iteratively. */
function sumArray(arr: readonly number[]): number {
    let total = 0;
    for (let i = 0; i < arr.length; i++) {
        total += arr[i] ?? 0;
    }
    return total;
}

// ---------------------------------------------------------------------------
// DicomReceiver class
// ---------------------------------------------------------------------------

/**
 * Pooled DICOM receiver with auto-scaling.
 *
 * Manages a pool of long-lived `Dcmrecv` workers behind a TCP proxy.
 * Incoming connections are routed to idle workers. Workers are reused
 * across associations and only stopped during scale-down or shutdown.
 *
 * @example
 * ```ts
 * const result = DicomReceiver.create({
 *     port: 4242,
 *     storageDir: '/data/received',
 *     minPoolSize: 2,
 *     maxPoolSize: 8,
 * });
 * if (!result.ok) { console.error(result.error.message); return; }
 * const receiver = result.value;
 *
 * receiver.onFileReceived(data => console.log('File:', data.filePath));
 * receiver.onAssociationComplete(data => console.log('Done:', data.associationDir));
 *
 * await receiver.start();
 * ```
 */
class DicomReceiver extends EventEmitter<DicomReceiverEventMap> {
    private readonly options: DicomReceiverOptions;
    private readonly minPoolSize: number;
    private readonly maxPoolSize: number;
    private readonly connectionTimeoutMs: number;
    private readonly workers: Map<number, Worker> = new Map();
    private tcpServer: net.Server | undefined;
    private associationCounter = 0;
    private started = false;
    private stopping = false;
    private abortHandler: (() => void) | undefined;

    private constructor(options: DicomReceiverOptions) {
        super();
        this.setMaxListeners(20);
        this.options = options;
        this.minPoolSize = options.minPoolSize ?? DEFAULT_MIN_POOL_SIZE;
        this.maxPoolSize = options.maxPoolSize ?? DEFAULT_MAX_POOL_SIZE;
        this.connectionTimeoutMs = options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Creates a new DicomReceiver instance.
     *
     * @param options - Configuration options
     * @returns A Result containing the instance or a validation error
     */
    static create(options: DicomReceiverOptions): Result<DicomReceiver> {
        const validation = DicomReceiverOptionsSchema.safeParse(options);
        if (!validation.success) {
            return err(createValidationError('DicomReceiver', validation.error));
        }
        return ok(new DicomReceiver(options));
    }

    /**
     * Starts the TCP proxy and spawns the initial worker pool.
     *
     * @returns A Result indicating success or failure
     */
    async start(): Promise<Result<void>> {
        if (this.started) {
            return err(new Error('DicomReceiver: already started'));
        }
        this.started = true;

        const storageDirResult = await ensureDirectory(this.options.storageDir);
        if (!storageDirResult.ok) return storageDirResult;

        const spawnResults = await this.spawnWorkers(this.minPoolSize);
        if (!spawnResults.ok) return spawnResults;

        const listenResult = await this.startTcpProxy();
        if (!listenResult.ok) return listenResult;

        if (this.options.signal !== undefined) {
            this.wireAbortSignal(this.options.signal);
        }

        return ok(undefined);
    }

    /**
     * Stops the TCP proxy and all workers.
     */
    async stop(): Promise<void> {
        if (!this.started || this.stopping) {
            return;
        }
        this.stopping = true;

        if (this.options.signal !== undefined && this.abortHandler !== undefined) {
            this.options.signal.removeEventListener('abort', this.abortHandler);
        }

        await this.closeTcpProxy();

        const stopPromises: Promise<void>[] = [];
        for (const worker of this.workers.values()) {
            stopPromises.push(this.stopWorker(worker));
        }
        await Promise.all(stopPromises);
        this.workers.clear();

        this.started = false;
        this.stopping = false;
    }

    /**
     * Registers a typed listener for a DicomReceiver-specific event.
     *
     * @param event - The event name from DicomReceiverEventMap
     * @param listener - Callback receiving typed event data
     * @returns this for chaining
     */
    onEvent<K extends keyof DicomReceiverEventMap>(event: K, listener: (...args: DicomReceiverEventMap[K]) => void): this {
        return this.on(event, listener as never);
    }

    /**
     * Registers a listener for received files.
     *
     * @param listener - Callback receiving file data
     * @returns this for chaining
     */
    onFileReceived(listener: (data: ReceiverFileData) => void): this {
        return this.on('FILE_RECEIVED', listener);
    }

    /**
     * Registers a listener for completed associations.
     *
     * @param listener - Callback receiving association data
     * @returns this for chaining
     */
    onAssociationComplete(listener: (data: ReceiverAssociationData) => void): this {
        return this.on('ASSOCIATION_COMPLETE', listener);
    }

    /**
     * Registers a listener for new associations (bubbled from workers).
     *
     * @param listener - Callback receiving association received data
     * @returns this for chaining
     */
    onAssociationReceived(listener: (data: PoolAssociationReceivedData) => void): this {
        return this.on('ASSOCIATION_RECEIVED', listener);
    }

    /**
     * Registers a listener for C-STORE requests (bubbled from workers).
     *
     * @param listener - Callback receiving C-STORE request data
     * @returns this for chaining
     */
    onCStoreRequest(listener: (data: PoolCStoreRequestData) => void): this {
        return this.on('C_STORE_REQUEST', listener);
    }

    /**
     * Registers a listener for C-ECHO requests (bubbled from workers).
     *
     * @param listener - Callback receiving echo request data
     * @returns this for chaining
     */
    onEchoRequest(listener: (data: PoolEchoRequestData) => void): this {
        return this.on('ECHO_REQUEST', listener);
    }

    /**
     * Registers a listener for refused associations (bubbled from workers).
     *
     * @param listener - Callback receiving refusing association data
     * @returns this for chaining
     */
    onRefusingAssociation(listener: (data: PoolRefusingAssociationData) => void): this {
        return this.on('REFUSING_ASSOCIATION', listener);
    }

    /**
     * Routes an external socket to an idle worker.
     *
     * The pool must be started via `start()` before calling this method.
     * Use this when managing your own TCP listener (e.g., protocol router).
     *
     * @param socket - An incoming net.Socket to route to a worker
     */
    handleSocket(socket: net.Socket): void {
        if (!this.started) {
            socket.destroy(new Error('DicomReceiver: not started'));
            return;
        }
        void this.handleConnection(socket);
    }

    /** Current pool status. */
    get poolStatus(): PoolStatus {
        let idle = 0;
        let busy = 0;
        for (const w of this.workers.values()) {
            if (w.state === 'idle') idle++;
            else busy++;
        }
        return { idle, busy, total: this.workers.size };
    }

    // -----------------------------------------------------------------------
    // TCP proxy
    // -----------------------------------------------------------------------

    /** Starts the TCP proxy on the configured port. Skips if port is 0. */
    private startTcpProxy(): Promise<Result<void>> {
        if (this.options.port === 0) {
            return Promise.resolve(ok(undefined));
        }
        return new Promise(resolve => {
            this.tcpServer = net.createServer(socket => {
                void this.handleConnection(socket);
            });
            this.tcpServer.on('error', e => {
                if (!this.started) {
                    resolve(err(new Error(`DicomReceiver: TCP proxy failed: ${e.message}`)));
                } else {
                    this.emit('error', { error: e instanceof Error ? e : new Error(String(e)) });
                }
            });
            this.tcpServer.listen(this.options.port, () => {
                resolve(ok(undefined));
            });
        });
    }

    /** Closes the TCP proxy server. */
    private closeTcpProxy(): Promise<void> {
        return new Promise(resolve => {
            if (this.tcpServer === undefined) {
                resolve();
                return;
            }
            this.tcpServer.close(() => resolve());
        });
    }

    // -----------------------------------------------------------------------
    // Connection routing
    // -----------------------------------------------------------------------

    /** Routes an incoming connection to an idle worker. */
    private async handleConnection(remoteSocket: net.Socket): Promise<void> {
        remoteSocket.pause();

        const worker = await this.findIdleWorker();
        if (worker === undefined) {
            remoteSocket.destroy(new Error('DicomReceiver: no idle worker available'));
            this.emit('error', { error: new Error('DicomReceiver: connection rejected — pool exhausted') });
            return;
        }

        this.associationCounter++;
        const associationId = `assoc-${String(this.associationCounter)}`;
        const associationDir = path.join(this.options.storageDir, associationId);

        const mkdirResult = await ensureDirectory(associationDir);
        if (!mkdirResult.ok) {
            remoteSocket.destroy();
            this.emit('error', { error: mkdirResult.error });
            return;
        }

        const ctx: AssociationContext = {
            associationId,
            associationDir,
            startAt: Date.now(),
        };

        worker.beginAssociation(ctx);
        this.pipeConnection(worker, remoteSocket);
        void this.replenishPool();
    }

    /** Finds an idle worker, retrying up to connectionTimeoutMs. */
    private async findIdleWorker(): Promise<Worker | undefined> {
        const idle = this.getIdleWorker();
        if (idle !== undefined) return idle;

        const maxRetries = Math.min(Math.ceil(this.connectionTimeoutMs / CONNECTION_RETRY_INTERVAL_MS), MAX_CONNECTION_RETRIES);

        for (let i = 0; i < maxRetries; i++) {
            await delay(CONNECTION_RETRY_INTERVAL_MS);
            const found = this.getIdleWorker();
            if (found !== undefined) return found;
            if (this.stopping) return undefined;
        }
        return undefined;
    }

    /** Returns the first idle worker, or undefined. */
    private getIdleWorker(): Worker | undefined {
        for (const w of this.workers.values()) {
            if (w.state === 'idle') return w;
        }
        return undefined;
    }

    /** Pipes remote socket bidirectionally to the worker's port. */
    private pipeConnection(worker: Worker, remoteSocket: net.Socket): void {
        const workerSocket = net.createConnection({ port: worker.port, host: '127.0.0.1' });

        worker.setSockets(remoteSocket, workerSocket);

        const cleanup = (): void => {
            remoteSocket.unpipe(workerSocket);
            workerSocket.unpipe(remoteSocket);
            if (!remoteSocket.destroyed) remoteSocket.destroy();
            if (!workerSocket.destroyed) workerSocket.destroy();
        };

        // Wait for the worker connection to be established before piping.
        // Writing to a socket before 'connect' buffers data in userland;
        // on Windows and some container runtimes this buffered data is
        // silently lost, causing the DICOM association handshake to hang.
        workerSocket.on('connect', () => {
            remoteSocket.pipe(workerSocket);
            workerSocket.pipe(remoteSocket);
            remoteSocket.resume();
        });

        remoteSocket.on('error', cleanup);
        workerSocket.on('error', cleanup);
        remoteSocket.on('close', cleanup);
        workerSocket.on('close', cleanup);
    }

    // -----------------------------------------------------------------------
    // Worker pool management
    // -----------------------------------------------------------------------

    /** Spawns `count` new workers and adds them to the pool. */
    private async spawnWorkers(count: number): Promise<Result<void>> {
        const promises: Promise<Result<Worker>>[] = [];
        for (let i = 0; i < count; i++) {
            promises.push(this.spawnWorker());
        }
        const results = await Promise.all(promises);
        for (const result of results) {
            if (!result.ok) return err(result.error);
        }
        return ok(undefined);
    }

    /** Creates a Dcmrecv instance with the pool's shared options. */
    private createDcmrecv(port: number, tempDir: string): Result<Dcmrecv> {
        return Dcmrecv.create({
            port,
            aeTitle: this.options.aeTitle,
            outputDirectory: tempDir,
            configFile: this.options.configFile,
            configProfile: this.options.configProfile,
            acseTimeout: this.options.acseTimeout,
            dimseTimeout: this.options.dimseTimeout,
            maxPdu: this.options.maxPdu,
            filenameMode: this.options.filenameMode ?? 'unique',
            filenameExtension: this.options.filenameExtension,
            storageMode: this.options.storageMode,
        });
    }

    /** Spawns a single Dcmrecv worker with an ephemeral port. */
    private async spawnWorker(): Promise<Result<Worker>> {
        const portResult = await allocatePort();
        if (!portResult.ok) return portResult;
        const port = portResult.value;

        const tempDir = path.join(os.tmpdir(), `dcmrecv-pool-${String(port)}-${String(Date.now())}`);
        const mkdirResult = await ensureDirectory(tempDir);
        if (!mkdirResult.ok) return mkdirResult;

        const createResult = this.createDcmrecv(port, tempDir);
        if (!createResult.ok) return createResult;

        const dcmrecv = createResult.value;
        const worker = new Worker(dcmrecv, port, tempDir);

        this.wireWorkerEvents(worker);
        const startResult = await dcmrecv.start();
        if (!startResult.ok) {
            return err(new Error(`DicomReceiver: worker start failed on port ${String(port)}: ${startResult.error.message}`));
        }

        this.workers.set(port, worker);
        return ok(worker);
    }

    /** Stops a single worker: destroy sockets, stop process, clean temp dir, remove from pool. */
    private async stopWorker(worker: Worker): Promise<void> {
        worker.destroySockets();
        await worker.dcmrecv.stop();
        worker.dcmrecv[Symbol.dispose]();
        await removeDirSafe(worker.tempDir);
        this.workers.delete(worker.port);
    }

    /** Pre-emptively spawns workers to keep idle count >= minPoolSize. */
    private async replenishPool(): Promise<void> {
        const status = this.poolStatus;
        const needed = this.minPoolSize - status.idle;
        const capacity = this.maxPoolSize - status.total;
        const toSpawn = Math.min(needed, capacity);

        if (toSpawn <= 0) return;

        const promises: Promise<Result<Worker>>[] = [];
        for (let i = 0; i < toSpawn; i++) {
            promises.push(this.spawnWorker());
        }
        const results = await Promise.all(promises);
        for (const result of results) {
            if (!result.ok) {
                this.emit('error', { error: result.error });
            }
        }
    }

    /** Stops excess idle workers when idle count > minPoolSize + 2. */
    private async scaleDown(): Promise<void> {
        const idleWorkers: Worker[] = [];
        for (const w of this.workers.values()) {
            if (w.state === 'idle') idleWorkers.push(w);
        }
        const excess = idleWorkers.length - (this.minPoolSize + 2);
        if (excess <= 0) return;

        const toStop = idleWorkers.slice(0, excess);
        const promises: Promise<void>[] = [];
        for (const w of toStop) {
            promises.push(this.stopWorker(w));
        }
        await Promise.all(promises);
    }

    // -----------------------------------------------------------------------
    // Worker event wiring
    // -----------------------------------------------------------------------

    /** Wires all events on a worker: file handling, association lifecycle, output capture. */
    private wireWorkerEvents(worker: Worker): void {
        this.wireFileReceived(worker);
        this.wireAssociationComplete(worker);
        this.wireAssociationReceived(worker);
        this.wireCStoreRequest(worker);
        this.wireEchoRequest(worker);
        this.wireRefusingAssociation(worker);
        this.wireOutputCapture(worker);
    }

    /** Wires FILE_RECEIVED from dcmrecv worker — captures context synchronously. */
    private wireFileReceived(worker: Worker): void {
        worker.dcmrecv.onFileReceived(data => {
            const ctx = worker.context;
            if (ctx === undefined) {
                this.emit('error', {
                    error: new Error(`DicomReceiver: FILE_RECEIVED with no active association (worker state: ${worker.state})`),
                    filePath: data.filePath,
                    callingAE: data.callingAE,
                    calledAE: data.calledAE,
                    source: data.source,
                });
                return;
            }

            const promise = this.handleFileReceived(worker, data, ctx);
            worker.trackFile(promise);
        });
    }

    /** Moves a received file, opens it as DicomInstance, and emits FILE_RECEIVED. */
    private async handleFileReceived(
        worker: Worker,
        data: { filePath: string; callingAE: string; calledAE: string; source: string },
        ctx: AssociationContext
    ): Promise<void> {
        try {
            await this.moveAndEmitFile(worker, data, ctx);
        } catch (thrown: unknown) {
            const error = thrown instanceof Error ? thrown : new Error(String(thrown));
            this.emit('error', {
                error,
                filePath: data.filePath,
                associationId: ctx.associationId,
                associationDir: ctx.associationDir,
                callingAE: data.callingAE,
                calledAE: data.calledAE,
                source: data.source,
            });
        }
    }

    /** Inner handler: move file, parse DICOM, emit FILE_RECEIVED or error. */
    private async moveAndEmitFile(
        worker: Worker,
        data: { filePath: string; callingAE: string; calledAE: string; source: string },
        ctx: AssociationContext
    ): Promise<void> {
        const srcPath = data.filePath;
        const destPath = path.join(ctx.associationDir, path.basename(srcPath));

        const moveResult = await moveFile(srcPath, destPath);
        const finalPath = moveResult.ok ? destPath : srcPath;
        const fileSize = await statFileSafe(finalPath);
        worker.recordFile(finalPath, fileSize);

        const openResult = await DicomInstance.open(finalPath);
        if (!openResult.ok) {
            this.emit('error', {
                error: openResult.error,
                filePath: finalPath,
                associationId: ctx.associationId,
                associationDir: ctx.associationDir,
                callingAE: data.callingAE,
                calledAE: data.calledAE,
                source: data.source,
            });
            return;
        }

        this.emit('FILE_RECEIVED', {
            filePath: finalPath,
            fileSize,
            associationId: ctx.associationId,
            associationDir: ctx.associationDir,
            callingAE: data.callingAE,
            calledAE: data.calledAE,
            source: data.source,
            instance: openResult.value,
        });
    }

    /** Returns worker to idle pool on association complete, emits summary. */
    private wireAssociationComplete(worker: Worker): void {
        worker.dcmrecv.onAssociationComplete((data: AssociationCompleteData) => {
            void this.finalizeAssociation(worker, data);
        });
    }

    /** Awaits ALL pending file operations, emits ASSOCIATION_COMPLETE, resets worker state. */
    private async finalizeAssociation(worker: Worker, data: AssociationCompleteData): Promise<void> {
        await worker.drainPendingFiles();
        this.emitAssociationComplete(worker, data);
        worker.endAssociation();
        void this.scaleDown();
    }

    /** Emits the ASSOCIATION_COMPLETE event with transfer stats. */
    private emitAssociationComplete(worker: Worker, data: AssociationCompleteData): void {
        const ctx = worker.context;
        const assocId = ctx?.associationId ?? data.associationId;
        const assocDir = ctx?.associationDir ?? '';
        const startAt = ctx?.startAt ?? Date.now();
        const files = [...worker.files];
        const output = [...worker.outputLines];

        const endAt = Date.now();
        const totalBytes = sumArray(worker.fileSizes);
        const elapsedMs = endAt - startAt;
        const bytesPerSecond = elapsedMs > 0 ? Math.round((totalBytes / elapsedMs) * 1000) : 0;

        this.emit('ASSOCIATION_COMPLETE', {
            associationId: assocId,
            associationDir: assocDir,
            callingAE: data.callingAE,
            calledAE: data.calledAE,
            source: data.source,
            files,
            durationMs: data.durationMs,
            endReason: data.endReason,
            totalBytes,
            bytesPerSecond,
            startAt,
            endAt,
            output,
        });
    }

    /** Bubbles ASSOCIATION_RECEIVED from dcmrecv worker. */
    private wireAssociationReceived(worker: Worker): void {
        worker.dcmrecv.onEvent('ASSOCIATION_RECEIVED', (data: { callingAE: string; calledAE: string; source: string }) => {
            this.emit('ASSOCIATION_RECEIVED', {
                associationId: worker.context?.associationId ?? '',
                callingAE: data.callingAE,
                calledAE: data.calledAE,
                source: data.source,
            });
        });
    }

    /** Bubbles C_STORE_REQUEST from dcmrecv worker. */
    private wireCStoreRequest(worker: Worker): void {
        worker.dcmrecv.onEvent('C_STORE_REQUEST', (data: { raw: string }) => {
            this.emit('C_STORE_REQUEST', {
                associationId: worker.context?.associationId ?? '',
                raw: data.raw,
            });
        });
    }

    /** Bubbles ECHO_REQUEST from dcmrecv worker. */
    private wireEchoRequest(worker: Worker): void {
        worker.dcmrecv.onEvent('ECHO_REQUEST', () => {
            this.emit('ECHO_REQUEST', {
                associationId: worker.context?.associationId ?? '',
            });
        });
    }

    /** Bubbles REFUSING_ASSOCIATION from dcmrecv worker. */
    private wireRefusingAssociation(worker: Worker): void {
        worker.dcmrecv.onEvent('REFUSING_ASSOCIATION', (data: { reason: string }) => {
            this.emit('REFUSING_ASSOCIATION', {
                reason: data.reason,
            });
        });
    }

    /** Captures worker output lines during busy associations. */
    private wireOutputCapture(worker: Worker): void {
        worker.dcmrecv.on('line', ({ text }: { text: string }) => {
            if (worker.state === 'busy') {
                worker.captureOutput(text);
            }
        });
    }

    // -----------------------------------------------------------------------
    // Abort signal
    // -----------------------------------------------------------------------

    /** Wires an AbortSignal to stop the receiver. */
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

export { DicomReceiver };
export type {
    DicomReceiverOptions,
    DicomReceiverEventMap,
    ReceiverFileData,
    ReceiverAssociationData,
    ReceiverErrorData,
    PoolStatus,
    PoolAssociationReceivedData,
    PoolCStoreRequestData,
    PoolEchoRequestData,
    PoolRefusingAssociationData,
};
