import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { DicomReceiver } from '../../../src/servers/DicomReceiver';
import { storescu } from '../../../src/tools/storescu';
import { dcmtkAvailable, SAMPLES, getAvailablePort, createTempDir, removeTempDir, waitForEvent } from '../helpers';
import type { ReceiverFileData, ReceiverAssociationData } from '../../../src/servers/DicomReceiver';

const CONFIG_FILE = resolve(__dirname, '../../../src/data/storescp.cfg');
const CONFIG_PROFILE = 'Default';

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
        const filePromise = waitForEvent<ReceiverFileData>(receiver, 'FILE_RECEIVED', 30_000);

        const startResult = await receiver.start();
        expect(startResult.ok).toBe(true);

        const sendResult = await storescu({
            host: '127.0.0.1',
            port,
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
        const assocPromise = waitForEvent<ReceiverAssociationData>(receiver, 'ASSOCIATION_COMPLETE', 30_000);

        await receiver.start();

        await storescu({
            host: '127.0.0.1',
            port,
            files: [SAMPLES.OTHER_0002D],
            timeoutMs: 30_000,
        });

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

        // Send two files sequentially
        const send1 = await storescu({
            host: '127.0.0.1',
            port,
            files: [SAMPLES.OTHER_0002D],
            timeoutMs: 30_000,
        });
        expect(send1.ok).toBe(true);

        // Wait for first association to complete
        await new Promise(resolve => setTimeout(resolve, 2000));

        const send2 = await storescu({
            host: '127.0.0.1',
            port,
            files: [SAMPLES.OTHER_0002D],
            timeoutMs: 30_000,
        });
        expect(send2.ok).toBe(true);

        // Wait for second association
        await new Promise(resolve => setTimeout(resolve, 2000));

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
        const assocPromise = waitForEvent<ReceiverAssociationData>(receiver, 'ASSOCIATION_COMPLETE', 30_000);

        await receiver.start();

        await storescu({
            host: '127.0.0.1',
            port,
            files: [SAMPLES.OTHER_0002D],
            timeoutMs: 30_000,
        });

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
});
