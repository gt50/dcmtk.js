import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcm2json } from './dcm2json';

vi.mock('../exec', () => ({
    execCommand: vi.fn(),
}));

vi.mock('./_resolveBinary', () => ({
    resolveBinary: vi.fn(),
}));

vi.mock('./_xmlToJson', () => ({
    xmlToJson: vi.fn(),
}));

vi.mock('./_repairJson', () => ({
    repairJson: vi.fn(),
}));

import { execCommand } from '../exec';
import { resolveBinary } from './_resolveBinary';
import { xmlToJson } from './_xmlToJson';
import { repairJson } from './_repairJson';

const mockedExecCommand = vi.mocked(execCommand);
const mockedResolveBinary = vi.mocked(resolveBinary);
const mockedXmlToJson = vi.mocked(xmlToJson);
const mockedRepairJson = vi.mocked(repairJson);

beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcm2xml' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '<xml/>', stderr: '', exitCode: 0 },
    });
    mockedXmlToJson.mockReturnValue({ ok: true, value: { '00100010': { vr: 'PN', Value: [{ Alphabetic: 'DOE^JOHN' }] } } });
});

describe('dcm2json', () => {
    describe('argument building', () => {
        it('passes -v for verbose verbosity via XML path', async () => {
            await dcm2json('/input.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity via XML path', async () => {
            await dcm2json('/input.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dcm2json('/input.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes -v for verbose verbosity via direct path', async () => {
            mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcm2json' });
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '{}', stderr: '', exitCode: 0 },
            });
            mockedRepairJson.mockReturnValue('{}');
            await dcm2json('/input.dcm', { verbosity: 'verbose', directOnly: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity via direct path', async () => {
            mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcm2json' });
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '{}', stderr: '', exitCode: 0 },
            });
            mockedRepairJson.mockReturnValue('{}');
            await dcm2json('/input.dcm', { verbosity: 'debug', directOnly: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });
    });

    describe('result handling', () => {
        it('returns data on success via XML path', async () => {
            const result = await dcm2json('/input.dcm');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.source).toBe('xml');
                expect(result.value.data).toBeDefined();
            }
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('not found') });
            const result = await dcm2json('/input.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({ ok: false, error: new Error('exec failed') });
            const result = await dcm2json('/input.dcm');
            expect(result.ok).toBe(false);
        });
    });
});
