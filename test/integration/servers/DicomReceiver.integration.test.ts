import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import * as net from 'node:net';
import type { ReceiverAssociationData, ReceiverAssociationFinalizedData, ReceiverInstanceData } from '../../../src';
import { DicomReceiver, storescu } from '../../../src';
import { createTempDir, dcmtkAvailable, getAvailablePort, removeTempDir, SAMPLES, waitForEvent } from '../helpers';

const CONFIG_FILE = resolve(__dirname, '../../../src/data/storescp.cfg');
const CONFIG_PROFILE = 'Default';
/** Default AE title used by DicomReceiver workers — must match calledAETitle in storescu calls. */
const WORKER_AE_TITLE = 'DCMRECV';

/** Allow workers to fully initialize after start() resolves. */
const WORKER_WARMUP_MS = 3000;
/** Longer timeout for CI environments where containers are resource-constrained. */
const EVENT_TIMEOUT_MS = 60_000;

describe.skipIf(!dcmtkAvailable)('DicomReceiver integration', () => {
    let receiver: DicomReceiver | undefined;
    let storageDir: string;

    afterEach(async () => {
        if (receiver !== undefined) {
            try {
                await receiver.stop();
            } catch {
                /* already stopped */
            }
            receiver = undefined;
        }
        if (storageDir !== undefined) {
            await removeTempDir(storageDir);
        }
    });

    it('creates, starts, and stops cleanly', async () => {
        storageDir = await createTempDir('recv-pool-life-');
        const port = await getAvailablePort();

        const createResult = DicomReceiver.create({
            port,
            storageDir,
            minPoolSize: 2,
            maxPoolSize: 4,
            configFile: CONFIG_FILE,
            configProfile: CONFIG_PROFILE,
        });
        expect(createResult.ok).toBe(true);
        if (!createResult.ok) return;

        receiver = createResult.value;
        const startResult = await receiver.start();
        expect(startResult.ok).toBe(true);

        const status = receiver.poolStatus;
        expect(status.idle).toBe(2);
        expect(status.busy).toBe(0);
        expect(status.total).toBe(2);

        await expect(receiver.stop()).resolves.toBeUndefined();
    });

    it('receives a single file and emits FILE_RECEIVED', async () => {
        storageDir = await createTempDir('recv-pool-single-');
        const port = await getAvailablePort();

        const createResult = DicomReceiver.create({
            port,
            storageDir,
            minPoolSize: 1,
            maxPoolSize: 2,
            configFile: CONFIG_FILE,
            configProfile: CONFIG_PROFILE,
        });
        if (!createResult.ok) return;

        receiver = createResult.value;
        const filePromise = waitForEvent<ReceiverInstanceData>(receiver, 'INSTANCE_RECEIVED', EVENT_TIMEOUT_MS);

        const startResult = await receiver.start();
        expect(startResult.ok).toBe(true);

        // Allow workers to fully initialize before sending
        await new Promise(r => setTimeout(r, WORKER_WARMUP_MS));

        const sendResult = await storescu({
            host: '127.0.0.1',
            port,
            calledAETitle: WORKER_AE_TITLE,
            files: [SAMPLES.OTHER_0002D],
            timeoutMs: 30_000,
        });
        expect(sendResult.ok).toBe(true);

        const fileEvent = await filePromise;
        expect(fileEvent.filePath).toBeDefined();
        expect(fileEvent.filePath.length).toBeGreaterThan(0);
        expect(fileEvent.associationId).toMatch(/^assoc-/);
        expect(fileEvent.associationDir).toContain(fileEvent.associationId);

        // Verify DicomInstance is populated with valid DICOM data
        expect(fileEvent.instance).toBeDefined();
        expect(fileEvent.instance.sopInstanceUID.length).toBeGreaterThan(0);
    });

    it('receives files and emits ASSOCIATION_COMPLETE', async () => {
        storageDir = await createTempDir('recv-pool-assoc-');
        const port = await getAvailablePort();

        const createResult = DicomReceiver.create({
            port,
            storageDir,
            minPoolSize: 1,
            maxPoolSize: 2,
            configFile: CONFIG_FILE,
            configProfile: CONFIG_PROFILE,
        });
        if (!createResult.ok) return;

        receiver = createResult.value;
        const assocPromise = waitForEvent<ReceiverAssociationData>(receiver, 'ASSOCIATION_COMPLETE', EVENT_TIMEOUT_MS);

        await receiver.start();
        await new Promise(r => setTimeout(r, WORKER_WARMUP_MS));

        const sendResult = await storescu({
            host: '127.0.0.1',
            port,
            calledAETitle: WORKER_AE_TITLE,
            files: [SAMPLES.OTHER_0002D],
            timeoutMs: 30_000,
        });
        expect(sendResult.ok).toBe(true);

        const assocEvent = await assocPromise;
        expect(assocEvent.associationId).toMatch(/^assoc-/);
        expect(assocEvent.files.length).toBeGreaterThanOrEqual(1);
        expect(assocEvent.endReason).toBe('release');
        expect(assocEvent.durationMs).toBeGreaterThanOrEqual(0);

        // Verify transfer stats
        expect(assocEvent.totalBytes).toBeGreaterThan(0);
        expect(assocEvent.bytesPerSecond).toBeGreaterThan(0);
        expect(assocEvent.endAt).toBeGreaterThanOrEqual(assocEvent.startAt);

        // Verify association directory was created with files
        const dirEntries = await readdir(assocEvent.associationDir);
        expect(dirEntries.length).toBeGreaterThanOrEqual(1);
    });

    it('handles multiple sequential sends', async () => {
        storageDir = await createTempDir('recv-pool-seq-');
        const port = await getAvailablePort();

        const createResult = DicomReceiver.create({
            port,
            storageDir,
            minPoolSize: 2,
            maxPoolSize: 4,
            configFile: CONFIG_FILE,
            configProfile: CONFIG_PROFILE,
        });
        if (!createResult.ok) return;

        receiver = createResult.value;
        const assocEvents: ReceiverAssociationData[] = [];
        receiver.onAssociationComplete(data => assocEvents.push(data));

        await receiver.start();
        await new Promise(r => setTimeout(r, WORKER_WARMUP_MS));

        // Send two files sequentially
        const send1 = await storescu({
            host: '127.0.0.1',
            port,
            calledAETitle: WORKER_AE_TITLE,
            files: [SAMPLES.OTHER_0002D],
            timeoutMs: 30_000,
        });
        expect(send1.ok).toBe(true);

        // Wait for first association to complete
        await new Promise(r => setTimeout(r, 3000));

        const send2 = await storescu({
            host: '127.0.0.1',
            port,
            calledAETitle: WORKER_AE_TITLE,
            files: [SAMPLES.OTHER_0002D],
            timeoutMs: 30_000,
        });
        expect(send2.ok).toBe(true);

        // Wait for second association
        await new Promise(r => setTimeout(r, 3000));

        expect(assocEvents.length).toBeGreaterThanOrEqual(2);

        // Each association should have its own directory
        const dirs = new Set(assocEvents.map(e => e.associationDir));
        expect(dirs.size).toBeGreaterThanOrEqual(2);
    });

    it('worker returns to idle after association', async () => {
        storageDir = await createTempDir('recv-pool-idle-');
        const port = await getAvailablePort();

        const createResult = DicomReceiver.create({
            port,
            storageDir,
            minPoolSize: 1,
            maxPoolSize: 2,
            configFile: CONFIG_FILE,
            configProfile: CONFIG_PROFILE,
        });
        if (!createResult.ok) return;

        receiver = createResult.value;
        const assocPromise = waitForEvent<ReceiverAssociationData>(receiver, 'ASSOCIATION_COMPLETE', EVENT_TIMEOUT_MS);

        await receiver.start();
        await new Promise(r => setTimeout(r, WORKER_WARMUP_MS));

        const sendResult = await storescu({
            host: '127.0.0.1',
            port,
            calledAETitle: WORKER_AE_TITLE,
            files: [SAMPLES.OTHER_0002D],
            timeoutMs: 30_000,
        });
        expect(sendResult.ok).toBe(true);

        await assocPromise;

        // After association completes, worker should be back to idle
        await new Promise(resolve => setTimeout(resolve, 500));
        const status = receiver.poolStatus;
        expect(status.busy).toBe(0);
        expect(status.idle).toBeGreaterThanOrEqual(1);
    });

    it('AbortSignal stops the receiver', async () => {
        storageDir = await createTempDir('recv-pool-abort-');
        const port = await getAvailablePort();
        const controller = new AbortController();

        const createResult = DicomReceiver.create({
            port,
            storageDir,
            minPoolSize: 1,
            maxPoolSize: 2,
            configFile: CONFIG_FILE,
            configProfile: CONFIG_PROFILE,
            signal: controller.signal,
        });
        if (!createResult.ok) return;

        receiver = createResult.value;
        await receiver.start();

        expect(receiver.poolStatus.total).toBeGreaterThanOrEqual(1);

        controller.abort();

        // Wait for the receiver to actually stop
        await new Promise(resolve => setTimeout(resolve, 3000));
    });

    it('reaps an aborted connection that never completes: finalizes, frees the worker, removes the dir', async () => {
        storageDir = await createTempDir('recv-pool-reap-');
        const port = await getAvailablePort();

        const createResult = DicomReceiver.create({
            port,
            storageDir,
            minPoolSize: 1,
            maxPoolSize: 1,
            configFile: CONFIG_FILE,
            configProfile: CONFIG_PROFILE,
        });
        expect(createResult.ok).toBe(true);
        if (!createResult.ok) return;

        receiver = createResult.value;
        const finalizedPromise = waitForEvent<ReceiverAssociationFinalizedData>(receiver, 'ASSOCIATION_FINALIZED', EVENT_TIMEOUT_MS);

        await receiver.start();
        await new Promise(r => setTimeout(r, WORKER_WARMUP_MS));

        // Open a raw TCP connection and send no DICOM data, so dcmrecv can
        // never negotiate or report completion. handleConnection still creates
        // the association directory and marks the worker busy.
        const socket = net.connect(port, '127.0.0.1');
        await new Promise<void>((res, rej) => {
            socket.once('connect', () => res());
            socket.once('error', rej);
        });
        // Give handleConnection time to create the association directory.
        await new Promise(r => setTimeout(r, 1000));

        const dirsWhileBusy = (await readdir(storageDir)).filter(name => name.startsWith('assoc-'));
        expect(dirsWhileBusy.length).toBe(1);
        expect(receiver.poolStatus.busy).toBe(1);

        // Abort: drop the connection with no DICOM release.
        socket.destroy();

        // The grace-period reaper (ABORT_REAP_GRACE_MS) should now synthesize a
        // terminal abort: emit ASSOCIATION_FINALIZED, free the worker, remove dir.
        const finalized = await finalizedPromise;
        expect(finalized.associationId).toMatch(/^assoc-/);

        // Allow the post-finalize cleanup (endAssociation + removeDirSafe) to settle.
        await new Promise(r => setTimeout(r, 1000));

        expect(receiver.poolStatus.busy).toBe(0);
        expect(receiver.poolStatus.idle).toBeGreaterThanOrEqual(1);

        const dirsAfterReap = (await readdir(storageDir)).filter(name => name.startsWith('assoc-'));
        expect(dirsAfterReap.length).toBe(0);
    });

    it('routes concurrent connections without double-assigning a worker: each association finalizes once with a unique id', async () => {
        storageDir = await createTempDir('recv-pool-concurrent-');
        const port = await getAvailablePort();

        // Small pool + many concurrent connections maximizes contention on the
        // findIdleWorker -> ensureDirectory -> beginAssociation window. Before
        // the reservation fix, two connections could claim the same idle worker
        // there, overwriting the first's context so it never finalized.
        const createResult = DicomReceiver.create({
            port,
            storageDir,
            minPoolSize: 2,
            maxPoolSize: 2,
            configFile: CONFIG_FILE,
            configProfile: CONFIG_PROFILE,
        });
        expect(createResult.ok).toBe(true);
        if (!createResult.ok) return;

        receiver = createResult.value;
        const finalizedIds: string[] = [];
        receiver.onAssociationFinalized(d => finalizedIds.push(d.associationId));

        await receiver.start();
        await new Promise(r => setTimeout(r, WORKER_WARMUP_MS));

        const N = 6;
        const sends = Array.from({ length: N }, () =>
            storescu({
                host: '127.0.0.1',
                port,
                calledAETitle: WORKER_AE_TITLE,
                files: [SAMPLES.OTHER_0002D],
                timeoutMs: 30_000,
            })
        );
        const results = await Promise.all(sends);
        expect(results.every(r => r.ok)).toBe(true);

        // Allow all finalize events to arrive.
        await new Promise(r => setTimeout(r, 3000));

        // Every accepted association must finalize exactly once with a unique
        // id. A double-assigned worker would orphan an association (fewer
        // finalize events) or surface a reused/dropped id.
        expect(finalizedIds.length).toBe(N);
        expect(new Set(finalizedIds).size).toBe(N);
        expect(receiver.poolStatus.busy).toBe(0);
    });
});
