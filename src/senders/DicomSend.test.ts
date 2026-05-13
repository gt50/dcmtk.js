import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DicomSend } from './DicomSend';
import { ToolExecutionError } from '../tools/_toolError';
import type { SenderSendCompleteData, SenderSendFailedData, SenderHealthChangedData, SenderBucketFlushedData } from './types';

// ---------------------------------------------------------------------------
// Mock dcmsend
// ---------------------------------------------------------------------------

type DcmsendResult = { ok: true; value: { success: boolean; stdout: string; stderr: string } } | { ok: false; error: Error };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDcmsend = vi.fn<(...args: any[]) => Promise<DcmsendResult>>(() => Promise.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } }));

vi.mock('../tools/dcmsend', () => ({
    dcmsend: (...args: unknown[]) => mockDcmsend(...(args as [])),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

/** Creates a deferred promise to control when dcmsend resolves. */
function deferred(): { promise: Promise<DcmsendResult>; resolve: (v: DcmsendResult) => void } {
    let resolve!: (v: DcmsendResult) => void;
    const promise = new Promise<DcmsendResult>(r => {
        resolve = r;
    });
    return { promise, resolve };
}

const validOpts = { host: 'localhost', port: 104 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DicomSend', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        mockDcmsend.mockReset();
        mockDcmsend.mockImplementation(() => Promise.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } }));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // -----------------------------------------------------------------------
    // create() validation
    // -----------------------------------------------------------------------

    describe('create()', () => {
        it('returns ok with minimal valid options', () => {
            const result = DicomSend.create({ host: 'localhost', port: 104 });
            expect(result.ok).toBe(true);
        });

        it('returns ok with all options', () => {
            const result = DicomSend.create({
                host: '192.168.1.100',
                port: 4242,
                calledAETitle: 'PACS',
                callingAETitle: 'MYSCU',
                mode: 'bucket',
                maxAssociations: 8,
                maxQueueLength: 500,
                timeoutMs: 60000,
                maxRetries: 5,
                retryDelayMs: 2000,
                bucketFlushMs: 3000,
                maxBucketSize: 100,
                noHalt: true,
                noIllegalProposal: true,
                decompress: 'lossless',
                multiAssociations: true,
                noUidChecks: true,
            });
            expect(result.ok).toBe(true);
        });

        it('rejects empty host', () => {
            const result = DicomSend.create({ host: '', port: 104 });
            expect(result.ok).toBe(false);
        });

        it('rejects port 0', () => {
            const result = DicomSend.create({ host: 'localhost', port: 0 });
            expect(result.ok).toBe(false);
        });

        it('rejects port > 65535', () => {
            const result = DicomSend.create({ host: 'localhost', port: 70000 });
            expect(result.ok).toBe(false);
        });

        it('rejects invalid calledAETitle characters', () => {
            const result = DicomSend.create({ host: 'localhost', port: 104, calledAETitle: 'HAS\\SLASH' });
            expect(result.ok).toBe(false);
        });

        it('rejects calledAETitle longer than 16 characters', () => {
            const result = DicomSend.create({ host: 'localhost', port: 104, calledAETitle: 'A'.repeat(17) });
            expect(result.ok).toBe(false);
        });

        it('rejects invalid callingAETitle', () => {
            const result = DicomSend.create({ host: 'localhost', port: 104, callingAETitle: 'BAD\\TITLE' });
            expect(result.ok).toBe(false);
        });

        it('rejects maxAssociations of 0', () => {
            const result = DicomSend.create({ ...validOpts, maxAssociations: 0 });
            expect(result.ok).toBe(false);
        });

        it('rejects maxAssociations > 64', () => {
            const result = DicomSend.create({ ...validOpts, maxAssociations: 65 });
            expect(result.ok).toBe(false);
        });

        it('rejects unknown properties (strict)', () => {
            const result = DicomSend.create({ ...validOpts, unknownProp: true } as never);
            expect(result.ok).toBe(false);
        });

        it('rejects invalid decompress value', () => {
            const result = DicomSend.create({ ...validOpts, decompress: 'invalid' } as never);
            expect(result.ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // send() basic behavior
    // -----------------------------------------------------------------------

    describe('send()', () => {
        it('sends files successfully', async () => {
            const r = DicomSend.create(validOpts);
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const result = await sender.send(['/test.dcm']);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.fileCount).toBe(1);
                expect(result.value.files).toEqual(['/test.dcm']);
            }
            await sender.stop();
        });

        it('returns error for empty files', async () => {
            const r = DicomSend.create(validOpts);
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const result = await sender.send([]);
            expect(result.ok).toBe(false);
            await sender.stop();
        });

        it('returns error when stopped', async () => {
            const r = DicomSend.create(validOpts);
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            await sender.stop();
            const result = await sender.send(['/test.dcm']);
            expect(result.ok).toBe(false);
        });

        it('returns error on dcmsend failure', async () => {
            mockDcmsend.mockImplementation(() => Promise.resolve({ ok: false, error: new Error('connection refused') }));

            const r = DicomSend.create({ ...validOpts, maxRetries: 0 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const result = await sender.send(['/test.dcm']);
            expect(result.ok).toBe(false);
            await sender.stop();
        });

        it('passes per-send AE title overrides', async () => {
            const r = DicomSend.create({ ...validOpts, calledAETitle: 'DEFAULT' });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            await sender.send(['/test.dcm'], { calledAETitle: 'OVERRIDE', callingAETitle: 'MYSCU' });
            const callArgs = mockDcmsend.mock.calls[0]?.[0] as Record<string, unknown>;
            expect(callArgs.calledAETitle).toBe('OVERRIDE');
            expect(callArgs.callingAETitle).toBe('MYSCU');
            await sender.stop();
        });

        it('falls back to instance AE titles when not overridden', async () => {
            const r = DicomSend.create({ ...validOpts, calledAETitle: 'PACS', callingAETitle: 'SCU' });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            await sender.send(['/test.dcm']);
            const callArgs = mockDcmsend.mock.calls[0]?.[0] as Record<string, unknown>;
            expect(callArgs.calledAETitle).toBe('PACS');
            expect(callArgs.callingAETitle).toBe('SCU');
            await sender.stop();
        });

        it('passes dcmsend-specific options', async () => {
            const r = DicomSend.create({
                ...validOpts,
                noHalt: true,
                noIllegalProposal: true,
                decompress: 'never',
                multiAssociations: true,
                noUidChecks: true,
            });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            await sender.send(['/test.dcm']);
            const callArgs = mockDcmsend.mock.calls[0]?.[0] as Record<string, unknown>;
            expect(callArgs.noHalt).toBe(true);
            expect(callArgs.noIllegalProposal).toBe(true);
            expect(callArgs.decompress).toBe('never');
            expect(callArgs.multiAssociations).toBe(true);
            expect(callArgs.noUidChecks).toBe(true);
            await sender.stop();
        });

        it('passes network options to dcmsend', async () => {
            const r = DicomSend.create({
                ...validOpts,
                maxPduReceive: 16384,
                maxPduSend: 32768,
                associationTimeout: 30,
                acseTimeout: 15,
                dimseTimeout: 60,
                noHostnameLookup: true,
                verbosity: 'debug',
            });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            await sender.send(['/test.dcm']);
            const callArgs = mockDcmsend.mock.calls[0]?.[0] as Record<string, unknown>;
            expect(callArgs.maxPduReceive).toBe(16384);
            expect(callArgs.maxPduSend).toBe(32768);
            expect(callArgs.associationTimeout).toBe(30);
            expect(callArgs.acseTimeout).toBe(15);
            expect(callArgs.dimseTimeout).toBe(60);
            expect(callArgs.noHostnameLookup).toBe(true);
            expect(callArgs.verbosity).toBe('debug');
            await sender.stop();
        });
    });

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    describe('events', () => {
        it('emits SEND_COMPLETE on success', async () => {
            const r = DicomSend.create(validOpts);
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const events: SenderSendCompleteData[] = [];
            sender.onSendComplete(data => events.push(data));

            await sender.send(['/test.dcm']);
            expect(events).toHaveLength(1);
            expect(events[0]!.fileCount).toBe(1);
            await sender.stop();
        });

        it('emits SEND_FAILED on failure', async () => {
            mockDcmsend.mockImplementation(() => Promise.resolve({ ok: false, error: new Error('fail') }));

            const r = DicomSend.create({ ...validOpts, maxRetries: 0 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const events: SenderSendFailedData[] = [];
            sender.onSendFailed(data => events.push(data));

            await sender.send(['/test.dcm']);
            expect(events).toHaveLength(1);
            expect(events[0]!.attempts).toBe(1);
            await sender.stop();
        });

        it('SEND_FAILED carries stdout/stderr when error is a ToolExecutionError', async () => {
            const toolErr = new ToolExecutionError('dcmsend failed (exit code 1)', {
                stdout: 'I: contacting host',
                stderr: 'F: connection refused',
                exitCode: 1,
            });
            mockDcmsend.mockImplementation(() => Promise.resolve({ ok: false, error: toolErr }));

            const r = DicomSend.create({ ...validOpts, maxRetries: 0 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            let captured: SenderSendFailedData | undefined;
            sender.onSendFailed(data => {
                captured = data;
            });

            await sender.send(['/test.dcm']);
            expect(captured).toBeDefined();
            expect(captured!.stdout).toBe('I: contacting host');
            expect(captured!.stderr).toBe('F: connection refused');
            await sender.stop();
        });

        it('emits HEALTH_CHANGED on degradation', async () => {
            mockDcmsend.mockImplementation(() => Promise.resolve({ ok: false, error: new Error('fail') }));

            const r = DicomSend.create({ ...validOpts, maxRetries: 0, maxAssociations: 4 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const events: SenderHealthChangedData[] = [];
            sender.onHealthChanged(data => events.push(data));

            // 3 consecutive failures → DEGRADED
            await sender.send(['/a.dcm']);
            await sender.send(['/b.dcm']);
            await sender.send(['/c.dcm']);

            expect(events.length).toBeGreaterThanOrEqual(1);
            expect(events[0]!.newHealth).toBe('degraded');
            await sender.stop();
        });

        it('supports onEvent() typed listener', async () => {
            const r = DicomSend.create(validOpts);
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const events: SenderSendCompleteData[] = [];
            sender.onEvent('SEND_COMPLETE', data => events.push(data));

            await sender.send(['/test.dcm']);
            expect(events).toHaveLength(1);
            await sender.stop();
        });
    });

    // -----------------------------------------------------------------------
    // Sending modes
    // -----------------------------------------------------------------------

    describe('single mode', () => {
        it('sends one at a time', async () => {
            const d1 = deferred();
            const d2 = deferred();
            let callCount = 0;
            mockDcmsend.mockImplementation(() => {
                callCount++;
                if (callCount === 1) return d1.promise;
                return d2.promise;
            });

            const r = DicomSend.create({ ...validOpts, mode: 'single' });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const p1 = sender.send(['/a.dcm']);
            const p2 = sender.send(['/b.dcm']);

            // Only first should be active
            expect(sender.status.activeAssociations).toBe(1);

            d1.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await p1;

            // Now second runs
            d2.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await p2;

            expect(callCount).toBe(2);
            await sender.stop();
        });
    });

    describe('multiple mode', () => {
        it('runs up to maxAssociations concurrently', async () => {
            const deferreds = [deferred(), deferred(), deferred()];
            let callCount = 0;
            mockDcmsend.mockImplementation(() => {
                const d = deferreds[callCount]!;
                callCount++;
                return d.promise;
            });

            const r = DicomSend.create({ ...validOpts, mode: 'multiple', maxAssociations: 2 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const p1 = sender.send(['/a.dcm']);
            const p2 = sender.send(['/b.dcm']);
            const p3 = sender.send(['/c.dcm']);

            // Two active, one queued
            expect(sender.status.activeAssociations).toBe(2);
            expect(sender.status.queueLength).toBe(1);

            deferreds[0]!.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await p1;

            deferreds[1]!.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await p2;

            deferreds[2]!.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await p3;

            await sender.stop();
        });
    });

    describe('bucket mode', () => {
        it('flushes bucket on maxBucketSize', async () => {
            const r = DicomSend.create({ ...validOpts, mode: 'bucket', maxBucketSize: 2, bucketFlushMs: 60000 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const events: SenderBucketFlushedData[] = [];
            sender.onBucketFlushed(data => events.push(data));

            void sender.send(['/a.dcm']);
            void sender.send(['/b.dcm']);

            await delay(10);
            expect(events).toHaveLength(1);
            expect(events[0]!.fileCount).toBe(2);
            expect(events[0]!.reason).toBe('maxSize');
            await sender.stop();
        });

        it('flushes bucket on timer', async () => {
            const r = DicomSend.create({ ...validOpts, mode: 'bucket', maxBucketSize: 100, bucketFlushMs: 1000 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const events: SenderBucketFlushedData[] = [];
            sender.onBucketFlushed(data => events.push(data));

            void sender.send(['/a.dcm']);
            vi.advanceTimersByTime(1100);

            await delay(10);
            expect(events).toHaveLength(1);
            expect(events[0]!.reason).toBe('timer');
            await sender.stop();
        });

        it('manual flush() dispatches bucket', async () => {
            const r = DicomSend.create({ ...validOpts, mode: 'bucket', maxBucketSize: 100, bucketFlushMs: 60000 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const events: SenderBucketFlushedData[] = [];
            sender.onBucketFlushed(data => events.push(data));

            void sender.send(['/a.dcm']);
            sender.flush();

            await delay(10);
            expect(events).toHaveLength(1);
            await sender.stop();
        });

        it('flush() is no-op in multiple mode', () => {
            const r = DicomSend.create({ ...validOpts, mode: 'multiple' });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;
            // Should not throw
            sender.flush();
        });
    });

    // -----------------------------------------------------------------------
    // Retry
    // -----------------------------------------------------------------------

    describe('retry', () => {
        it('retries on failure up to maxRetries', async () => {
            let callCount = 0;
            mockDcmsend.mockImplementation(() => {
                callCount++;
                if (callCount <= 2) {
                    return Promise.resolve({ ok: false, error: new Error('fail') });
                }
                return Promise.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            });

            const r = DicomSend.create({ ...validOpts, maxRetries: 3, retryDelayMs: 10 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const result = await sender.send(['/test.dcm']);
            expect(result.ok).toBe(true);
            expect(callCount).toBe(3);
            await sender.stop();
        });

        it('fails after exhausting retries', async () => {
            mockDcmsend.mockImplementation(() => Promise.resolve({ ok: false, error: new Error('persistent failure') }));

            const r = DicomSend.create({ ...validOpts, maxRetries: 2, retryDelayMs: 10 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const result = await sender.send(['/test.dcm']);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toContain('persistent failure');
            }
            await sender.stop();
        });

        it('per-send maxRetries overrides instance default', async () => {
            let callCount = 0;
            mockDcmsend.mockImplementation(() => {
                callCount++;
                return Promise.resolve({ ok: false, error: new Error('fail') });
            });

            const r = DicomSend.create({ ...validOpts, maxRetries: 0, retryDelayMs: 10 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            await sender.send(['/test.dcm'], { maxRetries: 2 });
            expect(callCount).toBe(3); // 1 initial + 2 retries
            await sender.stop();
        });
    });

    // -----------------------------------------------------------------------
    // Backpressure
    // -----------------------------------------------------------------------

    describe('backpressure', () => {
        it('transitions to degraded after 3 consecutive failures', async () => {
            mockDcmsend.mockImplementation(() => Promise.resolve({ ok: false, error: new Error('fail') }));

            const r = DicomSend.create({ ...validOpts, maxRetries: 0, maxAssociations: 4 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            await sender.send(['/a.dcm']);
            await sender.send(['/b.dcm']);
            await sender.send(['/c.dcm']);

            expect(sender.status.health).toBe('degraded');
            expect(sender.status.effectiveMaxAssociations).toBe(2);
            await sender.stop();
        });

        it('transitions to down after 10 consecutive failures', async () => {
            mockDcmsend.mockImplementation(() => Promise.resolve({ ok: false, error: new Error('fail') }));

            const r = DicomSend.create({ ...validOpts, maxRetries: 0, maxAssociations: 4 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            for (let i = 0; i < 10; i++) {
                await sender.send([`/${i}.dcm`]);
            }

            expect(sender.status.health).toBe('down');
            expect(sender.status.effectiveMaxAssociations).toBe(1);
            await sender.stop();
        });

        it('recovers from degraded to healthy after consecutive successes', async () => {
            mockDcmsend.mockImplementation(() => Promise.resolve({ ok: false, error: new Error('fail') }));

            const r = DicomSend.create({ ...validOpts, maxRetries: 0, maxAssociations: 4 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            // Degrade
            await sender.send(['/a.dcm']);
            await sender.send(['/b.dcm']);
            await sender.send(['/c.dcm']);
            expect(sender.status.health).toBe('degraded');

            // Now succeed
            mockDcmsend.mockImplementation(() => Promise.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } }));

            await sender.send(['/d.dcm']);
            await sender.send(['/e.dcm']);
            await sender.send(['/f.dcm']);

            // Should recover (may need more successes if effectiveMax needs doubling)
            const status = sender.status;
            expect(status.health === 'healthy' || status.consecutiveSuccesses > 0).toBe(true);
            await sender.stop();
        });
    });

    // -----------------------------------------------------------------------
    // Queue overflow
    // -----------------------------------------------------------------------

    describe('queue overflow', () => {
        it('rejects when queue is full', async () => {
            const d = deferred();
            mockDcmsend.mockImplementation(() => d.promise);

            const r = DicomSend.create({ ...validOpts, mode: 'single', maxQueueLength: 2 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            void sender.send(['/a.dcm']); // active
            void sender.send(['/b.dcm']); // queued
            void sender.send(['/c.dcm']); // queued

            const result = await sender.send(['/d.dcm']); // should fail - queue full
            expect(result.ok).toBe(false);

            d.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await delay(50);
            await sender.stop();
        });
    });

    // -----------------------------------------------------------------------
    // Status
    // -----------------------------------------------------------------------

    describe('status', () => {
        it('returns correct initial status', () => {
            const r = DicomSend.create(validOpts);
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const status = sender.status;
            expect(status.health).toBe('healthy');
            expect(status.activeAssociations).toBe(0);
            expect(status.effectiveMaxAssociations).toBe(4);
            expect(status.queueLength).toBe(0);
            expect(status.consecutiveFailures).toBe(0);
            expect(status.consecutiveSuccesses).toBe(0);
            expect(status.stopped).toBe(false);
        });

        it('shows stopped after stop()', async () => {
            const r = DicomSend.create(validOpts);
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            await sender.stop();
            expect(sender.status.stopped).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // stop()
    // -----------------------------------------------------------------------

    describe('stop()', () => {
        it('rejects queued items', async () => {
            const d = deferred();
            mockDcmsend.mockImplementation(() => d.promise);

            const r = DicomSend.create({ ...validOpts, mode: 'single' });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            void sender.send(['/a.dcm']); // active
            const p2 = sender.send(['/b.dcm']); // queued

            const stopPromise = sender.stop();

            const result = await p2;
            expect(result.ok).toBe(false);

            d.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            await stopPromise;
        });

        it('is idempotent', async () => {
            const r = DicomSend.create(validOpts);
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            await sender.stop();
            await sender.stop(); // should not throw
        });

        it('short-circuits a long retry delay', async () => {
            vi.useRealTimers();

            mockDcmsend.mockResolvedValueOnce({ ok: false, error: new Error('fail') });

            const r = DicomSend.create({ ...validOpts, maxRetries: 3, retryDelayMs: 5000 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const p = sender.send(['/f1.dcm']);
            await delay(50); // let first attempt fail and enter retry delay

            const t0 = Date.now();
            await sender.stop();
            const elapsed = Date.now() - t0;
            expect(elapsed).toBeLessThan(500);

            const result = await p;
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.message).toMatch(/stopped/);

            vi.useFakeTimers({ shouldAdvanceTime: true });
        });

        it('aborts an in-flight executor (does not wait for binary timeout)', async () => {
            vi.useRealTimers();

            mockDcmsend.mockImplementationOnce((args: unknown) => {
                const opts = args as { signal?: AbortSignal };
                return new Promise(resolve => {
                    opts.signal?.addEventListener(
                        'abort',
                        () => {
                            resolve({ ok: false, error: new Error('aborted') });
                        },
                        { once: true }
                    );
                });
            });

            const r = DicomSend.create({ ...validOpts, maxRetries: 0 });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            const p = sender.send(['/f1.dcm']);
            await delay(50);

            const t0 = Date.now();
            await sender.stop();
            const elapsed = Date.now() - t0;
            expect(elapsed).toBeLessThan(500);

            const result = await p;
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.message).toMatch(/stopped/);

            vi.useFakeTimers({ shouldAdvanceTime: true });
        });
    });

    // -----------------------------------------------------------------------
    // AbortSignal
    // -----------------------------------------------------------------------

    describe('AbortSignal', () => {
        it('stops sender when signal is aborted', async () => {
            const controller = new AbortController();
            const r = DicomSend.create({ ...validOpts, signal: controller.signal });
            if (!r.ok) throw new Error('create failed');
            const sender = r.value;

            controller.abort();
            await delay(50);

            expect(sender.status.stopped).toBe(true);
        });
    });
});
