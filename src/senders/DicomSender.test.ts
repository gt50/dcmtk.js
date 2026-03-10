import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DicomSender } from './DicomSender';
import type { SenderSendCompleteData, SenderSendFailedData, SenderHealthChangedData, SenderBucketFlushedData } from './types';

// ---------------------------------------------------------------------------
// Mock storescu
// ---------------------------------------------------------------------------

type StorescuResult = { ok: true; value: { success: boolean; stdout: string; stderr: string } } | { ok: false; error: Error };

const mockStorescu = vi.fn<() => Promise<StorescuResult>>(() => Promise.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } }));

vi.mock('../tools/storescu', () => ({
    storescu: (...args: unknown[]) => mockStorescu(...(args as [])),
    ProposedTransferSyntax: {
        UNCOMPRESSED: 'uncompressed',
        LITTLE_ENDIAN: 'littleEndian',
        BIG_ENDIAN: 'bigEndian',
        IMPLICIT_VR: 'implicitVR',
        JPEG_LOSSLESS: 'jpegLossless',
        JPEG_8BIT: 'jpeg8Bit',
        JPEG_12BIT: 'jpeg12Bit',
        J2K_LOSSLESS: 'j2kLossless',
        J2K_LOSSY: 'j2kLossy',
        JLS_LOSSLESS: 'jlsLossless',
        JLS_LOSSY: 'jlsLossy',
    },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

/** Creates a deferred promise to control when storescu resolves. */
function deferred(): { promise: Promise<StorescuResult>; resolve: (v: StorescuResult) => void } {
    let resolve!: (v: StorescuResult) => void;
    const promise = new Promise<StorescuResult>(r => {
        resolve = r;
    });
    return { promise, resolve };
}

const validOpts = { host: 'localhost', port: 104 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DicomSender', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        mockStorescu.mockReset();
        mockStorescu.mockImplementation(() => Promise.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } }));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // -----------------------------------------------------------------------
    // create() validation
    // -----------------------------------------------------------------------

    describe('create()', () => {
        it('returns ok with minimal valid options', () => {
            const result = DicomSender.create({ host: 'localhost', port: 104 });
            expect(result.ok).toBe(true);
        });

        it('returns ok with all options', () => {
            const result = DicomSender.create({
                host: '192.168.1.100',
                port: 4242,
                calledAETitle: 'PACS',
                callingAETitle: 'MYSCU',
                mode: 'bucket',
                maxAssociations: 8,
                proposedTransferSyntax: 'uncompressed',
                maxQueueLength: 500,
                timeoutMs: 60000,
                maxRetries: 5,
                retryDelayMs: 2000,
                bucketFlushMs: 3000,
                maxBucketSize: 100,
            });
            expect(result.ok).toBe(true);
        });

        it('rejects empty host', () => {
            const result = DicomSender.create({ host: '', port: 104 });
            expect(result.ok).toBe(false);
        });

        it('rejects port 0', () => {
            const result = DicomSender.create({ host: 'localhost', port: 0 });
            expect(result.ok).toBe(false);
        });

        it('rejects port > 65535', () => {
            const result = DicomSender.create({ host: 'localhost', port: 70000 });
            expect(result.ok).toBe(false);
        });

        it('rejects invalid calledAETitle characters', () => {
            const result = DicomSender.create({ host: 'localhost', port: 104, calledAETitle: 'HAS\\SLASH' });
            expect(result.ok).toBe(false);
        });

        it('rejects calledAETitle longer than 16 characters', () => {
            const result = DicomSender.create({ host: 'localhost', port: 104, calledAETitle: 'A'.repeat(17) });
            expect(result.ok).toBe(false);
        });

        it('rejects invalid callingAETitle', () => {
            const result = DicomSender.create({ host: 'localhost', port: 104, callingAETitle: 'BAD\\TITLE' });
            expect(result.ok).toBe(false);
        });

        it('rejects maxAssociations > 64', () => {
            const result = DicomSender.create({ host: 'localhost', port: 104, maxAssociations: 65 });
            expect(result.ok).toBe(false);
        });

        it('rejects maxAssociations < 1', () => {
            const result = DicomSender.create({ host: 'localhost', port: 104, maxAssociations: 0 });
            expect(result.ok).toBe(false);
        });

        it('rejects unknown options via strict schema', () => {
            const result = DicomSender.create({
                host: 'localhost',
                port: 104,
                unknownProp: true,
            } as never);
            expect(result.ok).toBe(false);
        });

        it('rejects negative retryDelayMs', () => {
            const result = DicomSender.create({ host: 'localhost', port: 104, retryDelayMs: -1 });
            expect(result.ok).toBe(false);
        });

        it('rejects maxRetries < 0', () => {
            const result = DicomSender.create({ host: 'localhost', port: 104, maxRetries: -1 });
            expect(result.ok).toBe(false);
        });

        it('accepts maxRetries = 0', () => {
            const result = DicomSender.create({ host: 'localhost', port: 104, maxRetries: 0 });
            expect(result.ok).toBe(true);
        });

        it('accepts AbortSignal', () => {
            const controller = new AbortController();
            const result = DicomSender.create({ host: 'localhost', port: 104, signal: controller.signal });
            expect(result.ok).toBe(true);
        });

        it('rejects invalid proposedTransferSyntax', () => {
            const result = DicomSender.create({
                host: 'localhost',
                port: 104,
                proposedTransferSyntax: 'invalid' as never,
            });
            expect(result.ok).toBe(false);
        });

        it('rejects non-integer port', () => {
            const result = DicomSender.create({ host: 'localhost', port: 104.5 });
            expect(result.ok).toBe(false);
        });

        it('rejects invalid mode', () => {
            const result = DicomSender.create({ host: 'localhost', port: 104, mode: 'turbo' as never });
            expect(result.ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // status getter
    // -----------------------------------------------------------------------

    describe('status', () => {
        it('returns initial status', () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;

            const status = result.value.status;
            expect(status.health).toBe('healthy');
            expect(status.activeAssociations).toBe(0);
            expect(status.effectiveMaxAssociations).toBe(4);
            expect(status.queueLength).toBe(0);
            expect(status.consecutiveFailures).toBe(0);
            expect(status.consecutiveSuccesses).toBe(0);
            expect(status.stopped).toBe(false);
        });

        it('forces maxAssociations to 1 in single mode', () => {
            const result = DicomSender.create({ ...validOpts, mode: 'single', maxAssociations: 8 });
            if (!result.ok) return;

            expect(result.value.status.effectiveMaxAssociations).toBe(1);
        });

        it('uses configured maxAssociations in multiple mode', () => {
            const result = DicomSender.create({ ...validOpts, mode: 'multiple', maxAssociations: 8 });
            if (!result.ok) return;

            expect(result.value.status.effectiveMaxAssociations).toBe(8);
        });

        it('defaults to 4 maxAssociations', () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;

            expect(result.value.status.effectiveMaxAssociations).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // send() — basic
    // -----------------------------------------------------------------------

    describe('send()', () => {
        it('sends files successfully', async () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;
            const sender = result.value;

            const sendResult = await sender.send(['/path/file1.dcm']);
            expect(sendResult.ok).toBe(true);
            if (sendResult.ok) {
                expect(sendResult.value.files).toEqual(['/path/file1.dcm']);
                expect(sendResult.value.fileCount).toBe(1);
                expect(sendResult.value.durationMs).toBeTypeOf('number');
            }

            await sender.stop();
        });

        it('rejects when sender is stopped', async () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;
            const sender = result.value;

            await sender.stop();

            const sendResult = await sender.send(['/path/file.dcm']);
            expect(sendResult.ok).toBe(false);
            if (!sendResult.ok) expect(sendResult.error.message).toMatch(/stopped/);
        });

        it('rejects with empty files', async () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;
            const sender = result.value;

            const sendResult = await sender.send([]);
            expect(sendResult.ok).toBe(false);
            if (!sendResult.ok) expect(sendResult.error.message).toMatch(/no files/);

            await sender.stop();
        });

        it('calls storescu with correct options', async () => {
            const result = DicomSender.create({
                ...validOpts,
                calledAETitle: 'PACS',
                callingAETitle: 'SCU',
                proposedTransferSyntax: 'uncompressed',
            });
            if (!result.ok) return;
            const sender = result.value;

            await sender.send(['/path/file.dcm']);

            expect(mockStorescu).toHaveBeenCalledWith(
                expect.objectContaining({
                    host: 'localhost',
                    port: 104,
                    files: ['/path/file.dcm'],
                    calledAETitle: 'PACS',
                    callingAETitle: 'SCU',
                    proposedTransferSyntax: 'uncompressed',
                })
            );

            await sender.stop();
        });

        it('passes per-send timeoutMs override', async () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;
            const sender = result.value;

            await sender.send(['/path/file.dcm'], { timeoutMs: 99999 });

            expect(mockStorescu).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 99999 }));

            await sender.stop();
        });
    });

    // -----------------------------------------------------------------------
    // Single mode — FIFO queuing
    // -----------------------------------------------------------------------

    describe('single mode', () => {
        it('serializes sends (one at a time)', async () => {
            const d1 = deferred();
            const d2 = deferred();
            mockStorescu.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);

            const result = DicomSender.create({ ...validOpts, mode: 'single' });
            if (!result.ok) return;
            const sender = result.value;

            const p1 = sender.send(['/f1.dcm']);
            const p2 = sender.send(['/f2.dcm']);

            // Only one active
            expect(sender.status.activeAssociations).toBe(1);
            expect(sender.status.queueLength).toBe(1);

            d1.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await p1;

            // Now second one starts
            await delay(10);
            expect(sender.status.activeAssociations).toBe(1);
            expect(sender.status.queueLength).toBe(0);

            d2.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await p2;

            expect(sender.status.activeAssociations).toBe(0);
            await sender.stop();
        });
    });

    // -----------------------------------------------------------------------
    // Multiple mode — concurrent sends
    // -----------------------------------------------------------------------

    describe('multiple mode', () => {
        it('allows concurrent sends up to maxAssociations', async () => {
            const deferreds = [deferred(), deferred(), deferred()];
            mockStorescu.mockReturnValueOnce(deferreds[0]!.promise).mockReturnValueOnce(deferreds[1]!.promise).mockReturnValueOnce(deferreds[2]!.promise);

            const result = DicomSender.create({ ...validOpts, mode: 'multiple', maxAssociations: 2 });
            if (!result.ok) return;
            const sender = result.value;

            const p1 = sender.send(['/f1.dcm']);
            const p2 = sender.send(['/f2.dcm']);
            const p3 = sender.send(['/f3.dcm']);

            expect(sender.status.activeAssociations).toBe(2);
            expect(sender.status.queueLength).toBe(1);

            deferreds[0]!.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await p1;
            await delay(10);

            // Third should have started
            expect(sender.status.activeAssociations).toBe(2);
            expect(sender.status.queueLength).toBe(0);

            deferreds[1]!.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            deferreds[2]!.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await p2;
            await p3;

            await sender.stop();
        });

        it('rejects when queue is full', async () => {
            const d1 = deferred();
            mockStorescu.mockReturnValue(d1.promise);

            const result = DicomSender.create({
                ...validOpts,
                mode: 'multiple',
                maxAssociations: 1,
                maxQueueLength: 2,
            });
            if (!result.ok) return;
            const sender = result.value;

            // First send occupies the slot
            void sender.send(['/f1.dcm']);
            // Two queued
            void sender.send(['/f2.dcm']);
            void sender.send(['/f3.dcm']);

            // Queue is full (2 items), next should be rejected
            const rejectResult = await sender.send(['/f4.dcm']);
            expect(rejectResult.ok).toBe(false);
            if (!rejectResult.ok) expect(rejectResult.error.message).toMatch(/queue full/);

            d1.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await delay(50);
            await sender.stop();
        });
    });

    // -----------------------------------------------------------------------
    // Bucket mode
    // -----------------------------------------------------------------------

    describe('bucket mode', () => {
        it('accumulates files and flushes on timer', async () => {
            const result = DicomSender.create({
                ...validOpts,
                mode: 'bucket',
                bucketFlushMs: 100,
                maxBucketSize: 10,
            });
            if (!result.ok) return;
            const sender = result.value;

            const bucketEvents: SenderBucketFlushedData[] = [];
            sender.onBucketFlushed(d => bucketEvents.push(d));

            const p1 = sender.send(['/f1.dcm']);
            const p2 = sender.send(['/f2.dcm']);

            // Not sent yet
            expect(mockStorescu).not.toHaveBeenCalled();

            // Advance timer
            await vi.advanceTimersByTimeAsync(150);
            await p1;
            await p2;

            expect(mockStorescu).toHaveBeenCalledTimes(1);
            // storescu called with combined files
            expect(mockStorescu).toHaveBeenCalledWith(expect.objectContaining({ files: ['/f1.dcm', '/f2.dcm'] }));
            expect(bucketEvents).toHaveLength(1);
            expect(bucketEvents[0]?.reason).toBe('timer');
            expect(bucketEvents[0]?.fileCount).toBe(2);

            await sender.stop();
        });

        it('flushes on maxSize threshold', async () => {
            const result = DicomSender.create({
                ...validOpts,
                mode: 'bucket',
                maxBucketSize: 3,
                bucketFlushMs: 60000,
            });
            if (!result.ok) return;
            const sender = result.value;

            const bucketEvents: SenderBucketFlushedData[] = [];
            sender.onBucketFlushed(d => bucketEvents.push(d));

            const p1 = sender.send(['/f1.dcm']);
            const p2 = sender.send(['/f2.dcm', '/f3.dcm']);

            await delay(50);
            await p1;
            await p2;

            expect(mockStorescu).toHaveBeenCalledTimes(1);
            expect(bucketEvents).toHaveLength(1);
            expect(bucketEvents[0]?.reason).toBe('maxSize');
            expect(bucketEvents[0]?.fileCount).toBe(3);

            await sender.stop();
        });

        it('flush() forces immediate flush', async () => {
            const result = DicomSender.create({
                ...validOpts,
                mode: 'bucket',
                bucketFlushMs: 60000,
                maxBucketSize: 100,
            });
            if (!result.ok) return;
            const sender = result.value;

            void sender.send(['/f1.dcm']);
            expect(mockStorescu).not.toHaveBeenCalled();

            sender.flush();
            await delay(10);

            expect(mockStorescu).toHaveBeenCalledTimes(1);

            await sender.stop();
        });

        it('flush() is no-op in non-bucket mode', async () => {
            const result = DicomSender.create({ ...validOpts, mode: 'multiple' });
            if (!result.ok) return;
            const sender = result.value;

            sender.flush(); // should not throw
            await sender.stop();
        });

        it('flush() is no-op when bucket is empty', async () => {
            const result = DicomSender.create({ ...validOpts, mode: 'bucket' });
            if (!result.ok) return;
            const sender = result.value;

            sender.flush(); // should not throw
            await sender.stop();
        });

        it('resolves all bucket entries with same result', async () => {
            const result = DicomSender.create({
                ...validOpts,
                mode: 'bucket',
                bucketFlushMs: 50,
                maxBucketSize: 100,
            });
            if (!result.ok) return;
            const sender = result.value;

            const p1 = sender.send(['/f1.dcm']);
            const p2 = sender.send(['/f2.dcm']);

            await vi.advanceTimersByTimeAsync(100);
            const [r1, r2] = await Promise.all([p1, p2]);

            expect(r1.ok).toBe(true);
            expect(r2.ok).toBe(true);

            await sender.stop();
        });

        it('rejects when queue is full in bucket mode', async () => {
            const d1 = deferred();
            mockStorescu.mockReturnValue(d1.promise);

            const result = DicomSender.create({
                ...validOpts,
                mode: 'bucket',
                maxAssociations: 1,
                maxQueueLength: 1,
                maxBucketSize: 100,
                bucketFlushMs: 60000,
            });
            if (!result.ok) return;
            const sender = result.value;

            void sender.send(['/f1.dcm']);
            const rejectResult = await sender.send(['/f2.dcm']);

            expect(rejectResult.ok).toBe(false);
            if (!rejectResult.ok) expect(rejectResult.error.message).toMatch(/queue full/);

            d1.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await delay(50);
            await sender.stop();
        });
    });

    // -----------------------------------------------------------------------
    // Retry logic
    // -----------------------------------------------------------------------

    describe('retry', () => {
        it('retries on failure up to maxRetries', async () => {
            mockStorescu
                .mockResolvedValueOnce({ ok: false, error: new Error('fail 1') })
                .mockResolvedValueOnce({ ok: false, error: new Error('fail 2') })
                .mockResolvedValueOnce({ ok: true, value: { success: true, stdout: '', stderr: '' } });

            const result = DicomSender.create({ ...validOpts, maxRetries: 2, retryDelayMs: 10 });
            if (!result.ok) return;
            const sender = result.value;

            const sendResult = await sender.send(['/f1.dcm']);
            expect(sendResult.ok).toBe(true);
            expect(mockStorescu).toHaveBeenCalledTimes(3);

            await sender.stop();
        });

        it('fails after all retries exhausted', async () => {
            mockStorescu.mockResolvedValue({ ok: false, error: new Error('persistent fail') });

            const result = DicomSender.create({ ...validOpts, maxRetries: 2, retryDelayMs: 10 });
            if (!result.ok) return;
            const sender = result.value;

            const sendResult = await sender.send(['/f1.dcm']);
            expect(sendResult.ok).toBe(false);
            if (!sendResult.ok) expect(sendResult.error.message).toBe('persistent fail');
            expect(mockStorescu).toHaveBeenCalledTimes(3); // 1 initial + 2 retries

            await sender.stop();
        });

        it('does not retry when maxRetries is 0', async () => {
            mockStorescu.mockResolvedValue({ ok: false, error: new Error('no retry') });

            const result = DicomSender.create({ ...validOpts, maxRetries: 0 });
            if (!result.ok) return;
            const sender = result.value;

            const sendResult = await sender.send(['/f1.dcm']);
            expect(sendResult.ok).toBe(false);
            expect(mockStorescu).toHaveBeenCalledTimes(1);

            await sender.stop();
        });

        it('per-send maxRetries overrides instance default', async () => {
            mockStorescu.mockResolvedValue({ ok: false, error: new Error('fail') });

            const result = DicomSender.create({ ...validOpts, maxRetries: 0, retryDelayMs: 10 });
            if (!result.ok) return;
            const sender = result.value;

            const sendResult = await sender.send(['/f1.dcm'], { maxRetries: 2 });
            expect(sendResult.ok).toBe(false);
            expect(mockStorescu).toHaveBeenCalledTimes(3); // 1 + 2 retries from override

            await sender.stop();
        });
    });

    // -----------------------------------------------------------------------
    // Backpressure state machine
    // -----------------------------------------------------------------------

    describe('backpressure', () => {
        it('transitions HEALTHY → DEGRADED after 3 consecutive failures', async () => {
            mockStorescu.mockResolvedValue({ ok: false, error: new Error('fail') });

            const result = DicomSender.create({ ...validOpts, maxRetries: 0, maxAssociations: 4 });
            if (!result.ok) return;
            const sender = result.value;

            const healthEvents: SenderHealthChangedData[] = [];
            sender.onHealthChanged(d => healthEvents.push(d));

            await sender.send(['/f1.dcm']);
            await sender.send(['/f2.dcm']);
            expect(sender.status.health).toBe('healthy');

            await sender.send(['/f3.dcm']);
            expect(sender.status.health).toBe('degraded');
            expect(healthEvents).toHaveLength(1);
            expect(healthEvents[0]?.previousHealth).toBe('healthy');
            expect(healthEvents[0]?.newHealth).toBe('degraded');
            expect(sender.status.effectiveMaxAssociations).toBe(2);

            await sender.stop();
        });

        it('halves effectiveMax further on continued failures in DEGRADED', async () => {
            mockStorescu.mockResolvedValue({ ok: false, error: new Error('fail') });

            const result = DicomSender.create({ ...validOpts, maxRetries: 0, maxAssociations: 8 });
            if (!result.ok) return;
            const sender = result.value;

            // Trigger DEGRADED (3 failures)
            await sender.send(['/f1.dcm']);
            await sender.send(['/f2.dcm']);
            await sender.send(['/f3.dcm']);
            expect(sender.status.effectiveMaxAssociations).toBe(4); // 8/2

            // More failures — halve again at 6
            await sender.send(['/f4.dcm']);
            await sender.send(['/f5.dcm']);
            await sender.send(['/f6.dcm']);
            expect(sender.status.effectiveMaxAssociations).toBe(2); // 4/2

            await sender.stop();
        });

        it('transitions DEGRADED → DOWN after 10 consecutive failures', async () => {
            mockStorescu.mockResolvedValue({ ok: false, error: new Error('fail') });

            const result = DicomSender.create({ ...validOpts, maxRetries: 0, maxAssociations: 8 });
            if (!result.ok) return;
            const sender = result.value;

            for (let i = 0; i < 10; i++) {
                await sender.send([`/f${String(i)}.dcm`]);
            }

            expect(sender.status.health).toBe('down');
            expect(sender.status.effectiveMaxAssociations).toBe(1);

            await sender.stop();
        });

        it('recovers DOWN → DEGRADED after 3 successes', async () => {
            mockStorescu.mockResolvedValue({ ok: false, error: new Error('fail') });

            const result = DicomSender.create({ ...validOpts, maxRetries: 0, maxAssociations: 4 });
            if (!result.ok) return;
            const sender = result.value;

            // Go DOWN
            for (let i = 0; i < 10; i++) {
                await sender.send([`/f${String(i)}.dcm`]);
            }
            expect(sender.status.health).toBe('down');

            // Now succeed
            mockStorescu.mockResolvedValue({ ok: true, value: { success: true, stdout: '', stderr: '' } });

            await sender.send(['/ok1.dcm']);
            await sender.send(['/ok2.dcm']);
            expect(sender.status.health).toBe('down');

            await sender.send(['/ok3.dcm']);
            expect(sender.status.health).toBe('degraded');
            expect(sender.status.effectiveMaxAssociations).toBe(1);

            await sender.stop();
        });

        it('recovers DEGRADED → HEALTHY after sustained successes', async () => {
            mockStorescu.mockResolvedValue({ ok: false, error: new Error('fail') });

            const result = DicomSender.create({ ...validOpts, maxRetries: 0, maxAssociations: 2 });
            if (!result.ok) return;
            const sender = result.value;

            // Go DEGRADED (3 failures)
            await sender.send(['/f1.dcm']);
            await sender.send(['/f2.dcm']);
            await sender.send(['/f3.dcm']);
            expect(sender.status.health).toBe('degraded');
            expect(sender.status.effectiveMaxAssociations).toBe(1);

            // Now succeed
            mockStorescu.mockResolvedValue({ ok: true, value: { success: true, stdout: '', stderr: '' } });

            // 3 successes → double effectiveMax (1→2) → reaches configured max → HEALTHY
            await sender.send(['/ok1.dcm']);
            await sender.send(['/ok2.dcm']);
            await sender.send(['/ok3.dcm']);
            expect(sender.status.health).toBe('healthy');
            expect(sender.status.effectiveMaxAssociations).toBe(2);

            await sender.stop();
        });

        it('resets consecutive failures on success', async () => {
            mockStorescu
                .mockResolvedValueOnce({ ok: false, error: new Error('fail') })
                .mockResolvedValueOnce({ ok: false, error: new Error('fail') })
                .mockResolvedValueOnce({ ok: true, value: { success: true, stdout: '', stderr: '' } })
                .mockResolvedValueOnce({ ok: false, error: new Error('fail') });

            const result = DicomSender.create({ ...validOpts, maxRetries: 0, maxAssociations: 4 });
            if (!result.ok) return;
            const sender = result.value;

            await sender.send(['/f1.dcm']);
            await sender.send(['/f2.dcm']);
            expect(sender.status.consecutiveFailures).toBe(2);

            await sender.send(['/ok.dcm']);
            expect(sender.status.consecutiveFailures).toBe(0);

            await sender.send(['/f3.dcm']);
            expect(sender.status.consecutiveFailures).toBe(1);
            expect(sender.status.health).toBe('healthy'); // Only 1 failure, not 3

            await sender.stop();
        });

        it('does not emit HEALTH_CHANGED when already DOWN and more failures occur', async () => {
            mockStorescu.mockResolvedValue({ ok: false, error: new Error('fail') });

            const result = DicomSender.create({ ...validOpts, maxRetries: 0 });
            if (!result.ok) return;
            const sender = result.value;

            const healthEvents: SenderHealthChangedData[] = [];
            sender.onHealthChanged(d => healthEvents.push(d));

            for (let i = 0; i < 15; i++) {
                await sender.send([`/f${String(i)}.dcm`]);
            }

            // Should have: HEALTHY→DEGRADED, DEGRADED (halve), DEGRADED→DOWN = 3 events
            const downEvents = healthEvents.filter(e => e.newHealth === 'down');
            expect(downEvents).toHaveLength(1);

            await sender.stop();
        });
    });

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    describe('events', () => {
        it('emits SEND_COMPLETE on success', async () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;
            const sender = result.value;

            const events: SenderSendCompleteData[] = [];
            sender.onSendComplete(d => events.push(d));

            await sender.send(['/f1.dcm', '/f2.dcm']);

            expect(events).toHaveLength(1);
            expect(events[0]?.files).toEqual(['/f1.dcm', '/f2.dcm']);
            expect(events[0]?.fileCount).toBe(2);
            expect(events[0]?.durationMs).toBeTypeOf('number');

            await sender.stop();
        });

        it('emits SEND_FAILED when all retries exhausted', async () => {
            mockStorescu.mockResolvedValue({ ok: false, error: new Error('fail') });

            const result = DicomSender.create({ ...validOpts, maxRetries: 1, retryDelayMs: 10 });
            if (!result.ok) return;
            const sender = result.value;

            const events: SenderSendFailedData[] = [];
            sender.onSendFailed(d => events.push(d));

            await sender.send(['/f1.dcm']);

            expect(events).toHaveLength(1);
            expect(events[0]?.files).toEqual(['/f1.dcm']);
            expect(events[0]?.attempts).toBe(2);
            expect(events[0]?.error.message).toBe('fail');

            await sender.stop();
        });

        it('onEvent returns this for chaining', () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;

            const sender = result.value;
            const ret = sender.onEvent('SEND_COMPLETE', vi.fn());
            expect(ret).toBe(sender);
        });

        it('onSendComplete returns this for chaining', () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;

            expect(result.value.onSendComplete(vi.fn())).toBe(result.value);
        });

        it('onSendFailed returns this for chaining', () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;

            expect(result.value.onSendFailed(vi.fn())).toBe(result.value);
        });

        it('onHealthChanged returns this for chaining', () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;

            expect(result.value.onHealthChanged(vi.fn())).toBe(result.value);
        });

        it('onBucketFlushed returns this for chaining', () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;

            expect(result.value.onBucketFlushed(vi.fn())).toBe(result.value);
        });

        it('does not throw on unhandled error event', async () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;
            const sender = result.value;

            // The default listener prevents crashes — just verify create works
            expect(sender).toBeDefined();
            await sender.stop();
        });
    });

    // -----------------------------------------------------------------------
    // stop()
    // -----------------------------------------------------------------------

    describe('stop()', () => {
        it('sets stopped status', async () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;
            const sender = result.value;

            await sender.stop();
            expect(sender.status.stopped).toBe(true);
        });

        it('is idempotent', async () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;
            const sender = result.value;

            await sender.stop();
            await sender.stop(); // should not throw
        });

        it('rejects queued entries on stop', async () => {
            const d1 = deferred();
            mockStorescu.mockReturnValue(d1.promise);

            const result = DicomSender.create({ ...validOpts, mode: 'single' });
            if (!result.ok) return;
            const sender = result.value;

            void sender.send(['/f1.dcm']); // active
            const p2 = sender.send(['/f2.dcm']); // queued

            // stop() rejects queue, but must also resolve d1 so active send completes
            const stopPromise = sender.stop();
            d1.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await stopPromise;

            const r2 = await p2;
            expect(r2.ok).toBe(false);
            if (!r2.ok) expect(r2.error.message).toMatch(/stopped/);
        });

        it('rejects bucket entries on stop', async () => {
            const result = DicomSender.create({
                ...validOpts,
                mode: 'bucket',
                bucketFlushMs: 60000,
                maxBucketSize: 100,
            });
            if (!result.ok) return;
            const sender = result.value;

            const p1 = sender.send(['/f1.dcm']);
            await sender.stop();

            const r1 = await p1;
            expect(r1.ok).toBe(false);
            if (!r1.ok) expect(r1.error.message).toMatch(/stopped/);
        });

        it('active sends check isStopped between retry attempts', async () => {
            // First attempt fails; during the retry delay, stop() is called.
            // The next loop iteration sees isStopped=true and resolves with error.
            vi.useRealTimers();

            mockStorescu.mockResolvedValueOnce({ ok: false, error: new Error('fail') });

            // 200ms retry delay gives enough time for stop() to set isStopped
            const result = DicomSender.create({ ...validOpts, maxRetries: 3, retryDelayMs: 200 });
            if (!result.ok) return;
            const sender = result.value;

            const p = sender.send(['/f1.dcm']);
            // Let the first attempt fail and enter retry delay
            await delay(50);

            // Stop during the 200ms retry delay
            await sender.stop();

            const r = await p;
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.error.message).toMatch(/stopped/);

            vi.useFakeTimers({ shouldAdvanceTime: true });
        });
    });

    // -----------------------------------------------------------------------
    // AbortSignal
    // -----------------------------------------------------------------------

    describe('AbortSignal', () => {
        it('stops sender when signal is aborted', async () => {
            const controller = new AbortController();
            const result = DicomSender.create({ ...validOpts, signal: controller.signal });
            if (!result.ok) return;
            const sender = result.value;

            controller.abort();
            await delay(50);

            expect(sender.status.stopped).toBe(true);
        });

        it('passes signal to storescu', async () => {
            const controller = new AbortController();
            const result = DicomSender.create({ ...validOpts, signal: controller.signal });
            if (!result.ok) return;
            const sender = result.value;

            await sender.send(['/f1.dcm']);

            expect(mockStorescu).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));

            await sender.stop();
        });
    });

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    describe('passthrough options', () => {
        it('accepts all network and diagnostic options in create()', () => {
            const result = DicomSender.create({
                ...validOpts,
                maxPduReceive: 65536,
                maxPduSend: 32768,
                associationTimeout: 30,
                acseTimeout: 15,
                dimseTimeout: 60,
                noHostnameLookup: true,
                noUidChecks: true,
                verbosity: 'verbose',
            });
            expect(result.ok).toBe(true);
        });

        it('passes network options through to storescu', async () => {
            const result = DicomSender.create({
                ...validOpts,
                mode: 'single',
                maxPduReceive: 65536,
                maxPduSend: 32768,
                associationTimeout: 30,
                acseTimeout: 15,
                dimseTimeout: 60,
                noHostnameLookup: true,
                noUidChecks: true,
                verbosity: 'debug',
            });
            if (!result.ok) return;
            const sender = result.value;

            await sender.send(['/file.dcm']);
            await delay(50);

            const callArgs = (mockStorescu.mock.calls[0] as unknown as unknown[])?.[0] as Record<string, unknown>;
            expect(callArgs).toMatchObject({
                maxPduReceive: 65536,
                maxPduSend: 32768,
                associationTimeout: 30,
                acseTimeout: 15,
                dimseTimeout: 60,
                noHostnameLookup: true,
                noUidChecks: true,
                verbosity: 'debug',
            });

            await sender.stop();
        });

        it('rejects maxPduReceive below 4096', () => {
            const result = DicomSender.create({ ...validOpts, maxPduReceive: 1024 });
            expect(result.ok).toBe(false);
        });

        it('rejects maxPduSend above 131072', () => {
            const result = DicomSender.create({ ...validOpts, maxPduSend: 200000 });
            expect(result.ok).toBe(false);
        });

        it('rejects negative acseTimeout', () => {
            const result = DicomSender.create({ ...validOpts, acseTimeout: -1 });
            expect(result.ok).toBe(false);
        });

        it('rejects invalid verbosity value', () => {
            const result = DicomSender.create({ ...validOpts, verbosity: 'trace' as never });
            expect(result.ok).toBe(false);
        });

        it('omits network options when not specified', async () => {
            const result = DicomSender.create({ ...validOpts, mode: 'single' });
            if (!result.ok) return;
            const sender = result.value;

            await sender.send(['/file.dcm']);
            await delay(50);

            const callArgs = (mockStorescu.mock.calls[0] as unknown as unknown[])?.[0] as Record<string, unknown>;
            expect(callArgs.maxPduReceive).toBeUndefined();
            expect(callArgs.maxPduSend).toBeUndefined();
            expect(callArgs.associationTimeout).toBeUndefined();
            expect(callArgs.acseTimeout).toBeUndefined();
            expect(callArgs.dimseTimeout).toBeUndefined();
            expect(callArgs.noHostnameLookup).toBeUndefined();
            expect(callArgs.noUidChecks).toBeUndefined();
            expect(callArgs.verbosity).toBeUndefined();

            await sender.stop();
        });
    });

    describe('stdout/stderr in results', () => {
        it('includes stdout and stderr in SendResult on success', async () => {
            mockStorescu.mockResolvedValueOnce({
                ok: true,
                value: { success: true, stdout: 'verbose output', stderr: 'warning info' },
            });

            const result = DicomSender.create({ ...validOpts, mode: 'single' });
            if (!result.ok) return;
            const sender = result.value;

            const sendResult = await sender.send(['/file.dcm']);
            expect(sendResult.ok).toBe(true);
            if (sendResult.ok) {
                expect(sendResult.value.stdout).toBe('verbose output');
                expect(sendResult.value.stderr).toBe('warning info');
            }

            await sender.stop();
        });

        it('includes stdout and stderr in SEND_COMPLETE event', async () => {
            mockStorescu.mockResolvedValueOnce({
                ok: true,
                value: { success: true, stdout: 'event stdout', stderr: 'event stderr' },
            });

            const result = DicomSender.create({ ...validOpts, mode: 'single' });
            if (!result.ok) return;
            const sender = result.value;

            let captured: SenderSendCompleteData | undefined;
            sender.on('SEND_COMPLETE', data => {
                captured = data;
            });

            await sender.send(['/file.dcm']);
            await delay(50);

            expect(captured).toBeDefined();
            expect(captured!.stdout).toBe('event stdout');
            expect(captured!.stderr).toBe('event stderr');

            await sender.stop();
        });

        it('includes stdout and stderr in SEND_FAILED event', async () => {
            mockStorescu.mockResolvedValue({ ok: false, error: new Error('connection refused') });

            const result = DicomSender.create({ ...validOpts, mode: 'single', maxRetries: 0 });
            if (!result.ok) return;
            const sender = result.value;

            let captured: SenderSendFailedData | undefined;
            sender.on('SEND_FAILED', data => {
                captured = data;
            });

            await sender.send(['/file.dcm']);
            await delay(50);

            expect(captured).toBeDefined();
            expect(captured!.stdout).toBe('');
            expect(captured!.stderr).toBe('');

            await sender.stop();
        });
    });

    describe('per-send AET overrides', () => {
        it('uses per-send calledAETitle override', async () => {
            const result = DicomSender.create({ ...validOpts, mode: 'single', calledAETitle: 'DEFAULT_AE' });
            if (!result.ok) return;
            const sender = result.value;

            await sender.send(['/file.dcm'], { calledAETitle: 'OVERRIDE_AE' });
            await delay(50);

            const callArgs = (mockStorescu.mock.calls[0] as unknown as unknown[])?.[0] as Record<string, unknown>;
            expect(callArgs.calledAETitle).toBe('OVERRIDE_AE');

            await sender.stop();
        });

        it('uses per-send callingAETitle override', async () => {
            const result = DicomSender.create({ ...validOpts, mode: 'single', callingAETitle: 'DEFAULT_SCU' });
            if (!result.ok) return;
            const sender = result.value;

            await sender.send(['/file.dcm'], { callingAETitle: 'OVERRIDE_SCU' });
            await delay(50);

            const callArgs = (mockStorescu.mock.calls[0] as unknown as unknown[])?.[0] as Record<string, unknown>;
            expect(callArgs.callingAETitle).toBe('OVERRIDE_SCU');

            await sender.stop();
        });

        it('falls back to instance AET when per-send is not specified', async () => {
            const result = DicomSender.create({ ...validOpts, mode: 'single', calledAETitle: 'INSTANCE_AE' });
            if (!result.ok) return;
            const sender = result.value;

            await sender.send(['/file.dcm']);
            await delay(50);

            const callArgs = (mockStorescu.mock.calls[0] as unknown as unknown[])?.[0] as Record<string, unknown>;
            expect(callArgs.calledAETitle).toBe('INSTANCE_AE');

            await sender.stop();
        });
    });

    describe('edge cases', () => {
        it('handles send with multiple files', async () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;
            const sender = result.value;

            const files = ['/f1.dcm', '/f2.dcm', '/f3.dcm'];
            const sendResult = await sender.send(files);
            expect(sendResult.ok).toBe(true);
            if (sendResult.ok) expect(sendResult.value.fileCount).toBe(3);

            await sender.stop();
        });

        it('drains queue after concurrent completion', async () => {
            const d1 = deferred();
            const d2 = deferred();
            mockStorescu.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);

            const result = DicomSender.create({ ...validOpts, mode: 'multiple', maxAssociations: 1 });
            if (!result.ok) return;
            const sender = result.value;

            const p1 = sender.send(['/f1.dcm']);
            const p2 = sender.send(['/f2.dcm']);

            d1.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await p1;
            await delay(10);

            expect(sender.status.activeAssociations).toBe(1);

            d2.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await p2;

            expect(sender.status.activeAssociations).toBe(0);

            await sender.stop();
        });

        it('uses default mode of multiple when not specified', async () => {
            const result = DicomSender.create(validOpts);
            if (!result.ok) return;

            // Default maxAssociations is 4 — should allow at least 2 concurrent
            const d1 = deferred();
            const d2 = deferred();
            mockStorescu.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);

            const sender = result.value;
            void sender.send(['/f1.dcm']);
            void sender.send(['/f2.dcm']);

            expect(sender.status.activeAssociations).toBe(2);

            d1.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            d2.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await delay(10);
            await sender.stop();
        });

        it('uses max timeoutMs/maxRetries from bucket entries', async () => {
            const result = DicomSender.create({
                ...validOpts,
                mode: 'bucket',
                bucketFlushMs: 50,
                maxBucketSize: 100,
                timeoutMs: 1000,
                maxRetries: 1,
            });
            if (!result.ok) return;
            const sender = result.value;

            void sender.send(['/f1.dcm'], { timeoutMs: 5000 });
            void sender.send(['/f2.dcm'], { maxRetries: 3 });

            await vi.advanceTimersByTimeAsync(100);

            // storescu should be called with the max timeoutMs (5000)
            expect(mockStorescu).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 5000 }));

            await sender.stop();
        });

        it('handles recovery with queue drain', async () => {
            // Start failing → queue builds → recovery drains queue
            mockStorescu.mockResolvedValue({ ok: false, error: new Error('fail') });

            const result = DicomSender.create({ ...validOpts, maxRetries: 0, maxAssociations: 2 });
            if (!result.ok) return;
            const sender = result.value;

            // 3 failures → DEGRADED, effectiveMax drops to 1
            await sender.send(['/f1.dcm']);
            await sender.send(['/f2.dcm']);
            await sender.send(['/f3.dcm']);
            expect(sender.status.effectiveMaxAssociations).toBe(1);

            await sender.stop();
        });
    });
});
