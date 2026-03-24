import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DicomHammer, generateUid } from './DicomHammer';

vi.mock('../tools/dcmsend', () => ({
    dcmsend: vi.fn(),
}));

vi.mock('../tools/dcmodify', () => ({
    dcmodify: vi.fn(),
}));

vi.mock('../dicom/_fileHelpers', () => ({
    copyFileSafe: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
    mkdir: vi.fn(),
    rm: vi.fn(),
    stat: vi.fn(),
}));

import { dcmsend } from '../tools/dcmsend';
import { dcmodify } from '../tools/dcmodify';
import { copyFileSafe } from '../dicom/_fileHelpers';
import { mkdir, rm, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';

const mockedDcmsend = vi.mocked(dcmsend);
const mockedDcmodify = vi.mocked(dcmodify);
const mockedCopyFileSafe = vi.mocked(copyFileSafe);
const mockedMkdir = vi.mocked(mkdir);
const mockedRm = vi.mocked(rm);
const mockedStat = vi.mocked(stat);

const validOpts = {
    sourceFile: '/path/to/template.dcm',
    host: '127.0.0.1',
    port: 8104,
};

beforeEach(() => {
    vi.clearAllMocks();
    mockedMkdir.mockResolvedValue(undefined);
    mockedRm.mockResolvedValue(undefined);
    mockedStat.mockResolvedValue({ size: 1024 } as Stats);
    mockedCopyFileSafe.mockResolvedValue({ ok: true, value: undefined });
    mockedDcmodify.mockResolvedValue({ ok: true, value: { filePath: '/tmp/hammer.dcm' } });
    mockedDcmsend.mockResolvedValue({ ok: true, value: { success: true, stdout: '', stderr: '' } });
});

describe('DicomHammer', () => {
    describe('create()', () => {
        it('creates with minimal valid options', () => {
            const result = DicomHammer.create(validOpts);
            expect(result.ok).toBe(true);
        });

        it('creates with all options', () => {
            const result = DicomHammer.create({
                ...validOpts,
                callingAETitle: 'TEST_SCU',
                calledAETitle: 'TEST_SCP',
                fileCount: 50,
                concurrency: 8,
                delayMs: 100,
                institution: 'TEST-HOSPITAL',
                erasePrivateTags: true,
                modifications: [{ tag: '(0010,0010)', value: 'HAMMER^TEST' }],
                timeoutMs: 5000,
                noHalt: false,
                outputDir: '/tmp/hammer-out',
            });
            expect(result.ok).toBe(true);
        });

        it('rejects invalid port', () => {
            const result = DicomHammer.create({ ...validOpts, port: 0 });
            expect(result.ok).toBe(false);
        });

        it('rejects port above 65535', () => {
            const result = DicomHammer.create({ ...validOpts, port: 70000 });
            expect(result.ok).toBe(false);
        });

        it('rejects empty host', () => {
            const result = DicomHammer.create({ ...validOpts, host: '' });
            expect(result.ok).toBe(false);
        });

        it('rejects empty sourceFile', () => {
            const result = DicomHammer.create({ ...validOpts, sourceFile: '' });
            expect(result.ok).toBe(false);
        });

        it('rejects fileCount of 0', () => {
            const result = DicomHammer.create({ ...validOpts, fileCount: 0 });
            expect(result.ok).toBe(false);
        });

        it('rejects fileCount above 100000', () => {
            const result = DicomHammer.create({ ...validOpts, fileCount: 100001 });
            expect(result.ok).toBe(false);
        });

        it('rejects concurrency of 0', () => {
            const result = DicomHammer.create({ ...validOpts, concurrency: 0 });
            expect(result.ok).toBe(false);
        });

        it('rejects concurrency above 64', () => {
            const result = DicomHammer.create({ ...validOpts, concurrency: 65 });
            expect(result.ok).toBe(false);
        });

        it('rejects invalid AE title', () => {
            const result = DicomHammer.create({ ...validOpts, callingAETitle: 'HAS BACKSLASH\\' });
            expect(result.ok).toBe(false);
        });

        it('rejects AE title longer than 16 chars', () => {
            const result = DicomHammer.create({ ...validOpts, calledAETitle: 'A'.repeat(17) });
            expect(result.ok).toBe(false);
        });

        it('rejects unknown options via strict mode', () => {
            const result = DicomHammer.create({ ...validOpts, unknownProp: true } as never);
            expect(result.ok).toBe(false);
        });

        it('rejects negative delayMs', () => {
            const result = DicomHammer.create({ ...validOpts, delayMs: -1 });
            expect(result.ok).toBe(false);
        });
    });

    describe('generate()', () => {
        it('generates the correct number of files', async () => {
            const r = DicomHammer.create({ ...validOpts, fileCount: 3 });
            expect(r.ok).toBe(true);
            if (!r.ok) return;

            const result = await r.value.generate();
            expect(result.ok).toBe(true);
            if (!result.ok) return;

            expect(result.value.files).toHaveLength(3);
            expect(mockedCopyFileSafe).toHaveBeenCalledTimes(3);
            expect(mockedDcmodify).toHaveBeenCalledTimes(3);
        });

        it('calls mkdir to create output directory', async () => {
            const r = DicomHammer.create({ ...validOpts, fileCount: 1 });
            if (!r.ok) return;

            await r.value.generate();
            expect(mockedMkdir).toHaveBeenCalledTimes(1);
        });

        it('passes modifications to dcmodify with unique UIDs', async () => {
            const r = DicomHammer.create({ ...validOpts, fileCount: 1, institution: 'TEST-INST' });
            if (!r.ok) return;

            await r.value.generate();
            const modCall = mockedDcmodify.mock.calls[0];
            const options = modCall?.[1];
            const mods = options?.modifications;

            expect(mods).toBeDefined();
            // Study UID, Series UID, SOP UID, Study Date, Accession, Institution
            expect(mods!.length).toBeGreaterThanOrEqual(6);

            const tags = mods!.map(m => m.tag);
            expect(tags).toContain('(0020,000D)');
            expect(tags).toContain('(0020,000E)');
            expect(tags).toContain('(0008,0018)');
            expect(tags).toContain('(0008,0050)');
            expect(tags).toContain('(0008,0080)');
        });

        it('includes custom modifications', async () => {
            const r = DicomHammer.create({
                ...validOpts,
                fileCount: 1,
                modifications: [{ tag: '(0010,0010)', value: 'CUSTOM^NAME' }],
            });
            if (!r.ok) return;

            await r.value.generate();
            const mods = mockedDcmodify.mock.calls[0]?.[1]?.modifications;
            const customMod = mods?.find(m => m.tag === '(0010,0010)');
            expect(customMod?.value).toBe('CUSTOM^NAME');
        });

        it('passes erasePrivateTags to dcmodify', async () => {
            const r = DicomHammer.create({ ...validOpts, fileCount: 1, erasePrivateTags: true });
            if (!r.ok) return;

            await r.value.generate();
            const options = mockedDcmodify.mock.calls[0]?.[1];
            expect(options?.erasePrivateTags).toBe(true);
        });

        it('emits FILE_GENERATED events', async () => {
            const r = DicomHammer.create({ ...validOpts, fileCount: 2 });
            if (!r.ok) return;

            const events: unknown[] = [];
            r.value.onFileGenerated(data => events.push(data));

            await r.value.generate();
            expect(events).toHaveLength(2);
        });

        it('emits PROGRESS events during generation', async () => {
            const r = DicomHammer.create({ ...validOpts, fileCount: 2 });
            if (!r.ok) return;

            const events: unknown[] = [];
            r.value.onProgress(data => {
                if (data.phase === 'generate') events.push(data);
            });

            await r.value.generate();
            expect(events).toHaveLength(2);
        });

        it('returns error when all generations fail', async () => {
            mockedCopyFileSafe.mockResolvedValue({ ok: false, error: new Error('copy failed') });

            const r = DicomHammer.create({ ...validOpts, fileCount: 2 });
            if (!r.ok) return;

            const result = await r.value.generate();
            expect(result.ok).toBe(false);
        });

        it('returns error when mkdir fails', async () => {
            mockedMkdir.mockRejectedValue(new Error('permission denied'));

            const r = DicomHammer.create({ ...validOpts, fileCount: 1 });
            if (!r.ok) return;

            const result = await r.value.generate();
            expect(result.ok).toBe(false);
        });

        it('returns partial success when some generations fail', async () => {
            let callCount = 0;
            mockedCopyFileSafe.mockImplementation(() => {
                callCount++;
                if (callCount === 2) return Promise.resolve({ ok: false, error: new Error('copy failed') });
                return Promise.resolve({ ok: true, value: undefined });
            });

            const r = DicomHammer.create({ ...validOpts, fileCount: 3 });
            if (!r.ok) return;

            const result = await r.value.generate();
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.files).toHaveLength(2);
        });

        it('returns durationMs in result', async () => {
            const r = DicomHammer.create({ ...validOpts, fileCount: 1 });
            if (!r.ok) return;

            const result = await r.value.generate();
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
        });
    });

    describe('send()', () => {
        it('sends each file via dcmsend', async () => {
            const r = DicomHammer.create({ ...validOpts, fileCount: 3 });
            if (!r.ok) return;

            await r.value.generate();
            const result = await r.value.send();
            expect(result.ok).toBe(true);
            if (!result.ok) return;

            expect(mockedDcmsend).toHaveBeenCalledTimes(3);
            expect(result.value.succeeded).toBe(3);
            expect(result.value.failed).toBe(0);
        });

        it('accepts explicit file list', async () => {
            const r = DicomHammer.create(validOpts);
            if (!r.ok) return;

            const result = await r.value.send(['/a.dcm', '/b.dcm']);
            expect(result.ok).toBe(true);
            if (!result.ok) return;

            expect(mockedDcmsend).toHaveBeenCalledTimes(2);
            expect(result.value.totalFiles).toBe(2);
        });

        it('returns error when no files to send', async () => {
            const r = DicomHammer.create(validOpts);
            if (!r.ok) return;

            const result = await r.value.send();
            expect(result.ok).toBe(false);
        });

        it('passes host, port, and AE titles to dcmsend', async () => {
            const r = DicomHammer.create({
                ...validOpts,
                callingAETitle: 'MY_SCU',
                calledAETitle: 'MY_SCP',
            });
            if (!r.ok) return;

            await r.value.send(['/test.dcm']);
            const callOpts = mockedDcmsend.mock.calls[0]?.[0];
            expect(callOpts?.host).toBe('127.0.0.1');
            expect(callOpts?.port).toBe(8104);
            expect(callOpts?.callingAETitle).toBe('MY_SCU');
            expect(callOpts?.calledAETitle).toBe('MY_SCP');
        });

        it('tracks failures and returns errors', async () => {
            let callCount = 0;
            mockedDcmsend.mockImplementation(() => {
                callCount++;
                if (callCount === 2) return Promise.resolve({ ok: false, error: new Error('send failed') });
                return Promise.resolve({ ok: true, value: { success: true, stdout: '', stderr: '' } });
            });

            const r = DicomHammer.create(validOpts);
            if (!r.ok) return;

            const result = await r.value.send(['/a.dcm', '/b.dcm', '/c.dcm']);
            expect(result.ok).toBe(true);
            if (!result.ok) return;

            expect(result.value.succeeded).toBe(2);
            expect(result.value.failed).toBe(1);
            expect(result.value.errors).toHaveLength(1);
        });

        it('emits PROGRESS events during sending', async () => {
            const r = DicomHammer.create(validOpts);
            if (!r.ok) return;

            const events: unknown[] = [];
            r.value.onProgress(data => {
                if (data.phase === 'send') events.push(data);
            });

            await r.value.send(['/a.dcm', '/b.dcm']);
            expect(events).toHaveLength(2);
        });

        it('computes filesPerSec', async () => {
            const r = DicomHammer.create(validOpts);
            if (!r.ok) return;

            const result = await r.value.send(['/a.dcm']);
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.filesPerSec).toBeGreaterThanOrEqual(0);
        });

        it('computes totalBytes from file size', async () => {
            mockedStat.mockResolvedValue({ size: 2048 } as Stats);

            const r = DicomHammer.create(validOpts);
            if (!r.ok) return;

            const result = await r.value.send(['/a.dcm', '/b.dcm']);
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.totalBytes).toBe(4096);
        });

        it('passes noHalt to dcmsend', async () => {
            const r = DicomHammer.create({ ...validOpts, noHalt: true });
            if (!r.ok) return;

            await r.value.send(['/test.dcm']);
            const callOpts = mockedDcmsend.mock.calls[0]?.[0];
            expect(callOpts?.noHalt).toBe(true);
        });
    });

    describe('run()', () => {
        it('generates and sends in one call', async () => {
            const r = DicomHammer.create({ ...validOpts, fileCount: 2 });
            if (!r.ok) return;

            const result = await r.value.run();
            expect(result.ok).toBe(true);
            if (!result.ok) return;

            expect(result.value.totalFiles).toBe(2);
            expect(result.value.generateDurationMs).toBeGreaterThanOrEqual(0);
            expect(result.value.sendDurationMs).toBeGreaterThanOrEqual(0);
            expect(result.value.durationMs).toBe(result.value.generateDurationMs + result.value.sendDurationMs);
        });

        it('emits RUN_COMPLETE event', async () => {
            const r = DicomHammer.create({ ...validOpts, fileCount: 1 });
            if (!r.ok) return;

            const events: unknown[] = [];
            r.value.onRunComplete(data => events.push(data));

            await r.value.run();
            expect(events).toHaveLength(1);
        });

        it('returns error when generate fails', async () => {
            mockedMkdir.mockRejectedValue(new Error('no space'));

            const r = DicomHammer.create({ ...validOpts, fileCount: 1 });
            if (!r.ok) return;

            const result = await r.value.run();
            expect(result.ok).toBe(false);
        });
    });

    describe('cleanup()', () => {
        it('removes the generated directory', async () => {
            const r = DicomHammer.create({ ...validOpts, fileCount: 1 });
            if (!r.ok) return;

            await r.value.generate();
            const result = await r.value.cleanup();
            expect(result.ok).toBe(true);
            expect(mockedRm).toHaveBeenCalledTimes(1);
        });

        it('succeeds when no directory to clean', async () => {
            const r = DicomHammer.create(validOpts);
            if (!r.ok) return;

            const result = await r.value.cleanup();
            expect(result.ok).toBe(true);
            expect(mockedRm).not.toHaveBeenCalled();
        });

        it('returns error when rm fails', async () => {
            mockedRm.mockRejectedValue(new Error('permission denied'));

            const r = DicomHammer.create({ ...validOpts, fileCount: 1 });
            if (!r.ok) return;

            await r.value.generate();
            const result = await r.value.cleanup();
            expect(result.ok).toBe(false);
        });
    });

    describe('generateUid()', () => {
        it('starts with DICOM UID root 2.25.', () => {
            const uid = generateUid();
            expect(uid.startsWith('2.25.')).toBe(true);
        });

        it('is at most 64 characters', () => {
            for (let i = 0; i < 100; i++) {
                expect(generateUid().length).toBeLessThanOrEqual(64);
            }
        });

        it('contains only digits and dots', () => {
            for (let i = 0; i < 100; i++) {
                expect(generateUid()).toMatch(/^[\d.]+$/);
            }
        });

        it('generates unique UIDs', () => {
            const uids = new Set<string>();
            for (let i = 0; i < 1000; i++) {
                uids.add(generateUid());
            }
            expect(uids.size).toBe(1000);
        });
    });
});
