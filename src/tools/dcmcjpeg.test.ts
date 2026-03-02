import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmcjpeg } from './dcmcjpeg';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmcjpeg' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcmcjpeg', () => {
    describe('argument building', () => {
        it('passes -v for verbose', async () => {
            await dcmcjpeg('/input.dcm', '/output.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug', async () => {
            await dcmcjpeg('/input.dcm', '/output.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity when not specified', async () => {
            await dcmcjpeg('/input.dcm', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes +p for progressive', async () => {
            await dcmcjpeg('/input.dcm', '/output.dcm', { progressive: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+p');
        });

        it('passes +e1 for lossless', async () => {
            await dcmcjpeg('/input.dcm', '/output.dcm', { lossless: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+e1');
        });

        it('passes +q with quality value', async () => {
            await dcmcjpeg('/input.dcm', '/output.dcm', { quality: 90 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+q');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('90');
        });

        it('includes input and output paths at the end', async () => {
            await dcmcjpeg('/input.dcm', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 2]).toBe('/input.dcm');
            expect(args[args.length - 1]).toBe('/output.dcm');
        });

        it('omits optional flags when not specified', async () => {
            await dcmcjpeg('/input.dcm', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('+p');
            expect(args).not.toContain('+e1');
            expect(args).not.toContain('+q');
        });
    });

    describe('validation', () => {
        it('rejects quality below 1', async () => {
            const result = await dcmcjpeg('/input.dcm', '/output.dcm', { quality: 0 });
            expect(result.ok).toBe(false);
        });

        it('rejects quality above 100', async () => {
            const result = await dcmcjpeg('/input.dcm', '/output.dcm', { quality: 101 });
            expect(result.ok).toBe(false);
        });

        it('accepts valid quality', async () => {
            const result = await dcmcjpeg('/input.dcm', '/output.dcm', { quality: 75 });
            expect(result.ok).toBe(true);
        });
    });

    describe('result handling', () => {
        it('returns outputPath on success', async () => {
            const result = await dcmcjpeg('/input.dcm', '/output.dcm');
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
            const result = await dcmcjpeg('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dcmcjpeg('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcmcjpeg('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });
    });
});
