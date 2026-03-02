import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmcjpls } from './dcmcjpls';

vi.mock('../exec', () => ({
    execCommand: vi.fn(),
}));

vi.mock('./_resolveBinary', () => ({
    resolveBinary: vi.fn(),
}));

import { execCommand } from '../exec';
import { resolveBinary } from './_resolveBinary';

const mockedExecCommand = vi.mocked(execCommand);
const mockedResolveBinary = vi.mocked(resolveBinary);

beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmcjpls' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcmcjpls', () => {
    describe('argument building', () => {
        it('passes -v for verbose', async () => {
            await dcmcjpls('/input.dcm', '/output.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug', async () => {
            await dcmcjpls('/input.dcm', '/output.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity when not specified', async () => {
            await dcmcjpls('/input.dcm', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes +el for lossless true', async () => {
            await dcmcjpls('/input.dcm', '/output.dcm', { lossless: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+el');
        });

        it('passes +en for lossless false (near-lossless)', async () => {
            await dcmcjpls('/input.dcm', '/output.dcm', { lossless: false });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+en');
        });

        it('passes +md with maxDeviation value', async () => {
            await dcmcjpls('/input.dcm', '/output.dcm', { maxDeviation: 3 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+md');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('3');
        });

        it('includes input and output paths at the end', async () => {
            await dcmcjpls('/input.dcm', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 2]).toBe('/input.dcm');
            expect(args[args.length - 1]).toBe('/output.dcm');
        });
    });

    describe('validation', () => {
        it('rejects negative maxDeviation', async () => {
            const result = await dcmcjpls('/input.dcm', '/output.dcm', { maxDeviation: -1 });
            expect(result.ok).toBe(false);
        });

        it('accepts zero maxDeviation', async () => {
            const result = await dcmcjpls('/input.dcm', '/output.dcm', { maxDeviation: 0 });
            expect(result.ok).toBe(true);
        });
    });

    describe('result handling', () => {
        it('returns outputPath on success', async () => {
            const result = await dcmcjpls('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.outputPath).toBe('/output.dcm');
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'compression failed', exitCode: 1 },
            });
            const result = await dcmcjpls('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dcmcjpls('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcmcjpls('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });
    });
});
