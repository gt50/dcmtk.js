import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmscale } from './dcmscale';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmscale' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcmscale', () => {
    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await dcmscale('/input.dcm', '/output.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await dcmscale('/input.dcm', '/output.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dcmscale('/input.dcm', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes +Sxf with xFactor value', async () => {
            await dcmscale('/input.dcm', '/output.dcm', { xFactor: 0.5 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+Sxf');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('0.5');
        });

        it('passes +Syf with yFactor value', async () => {
            await dcmscale('/input.dcm', '/output.dcm', { yFactor: 2 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+Syf');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('2');
        });

        it('passes +Sxv with xSize value', async () => {
            await dcmscale('/input.dcm', '/output.dcm', { xSize: 512 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+Sxv');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('512');
        });

        it('passes +Syv with ySize value', async () => {
            await dcmscale('/input.dcm', '/output.dcm', { ySize: 256 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+Syv');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('256');
        });

        it('includes input and output paths at the end', async () => {
            await dcmscale('/input.dcm', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 2]).toBe('/input.dcm');
            expect(args[args.length - 1]).toBe('/output.dcm');
        });
    });

    describe('validation', () => {
        it('rejects xFactor above 100', async () => {
            const result = await dcmscale('/input.dcm', '/output.dcm', { xFactor: 101 });
            expect(result.ok).toBe(false);
        });

        it('rejects non-positive xFactor', async () => {
            const result = await dcmscale('/input.dcm', '/output.dcm', { xFactor: 0 });
            expect(result.ok).toBe(false);
        });

        it('accepts valid xFactor', async () => {
            const result = await dcmscale('/input.dcm', '/output.dcm', { xFactor: 1.5 });
            expect(result.ok).toBe(true);
        });
    });

    describe('result handling', () => {
        it('returns outputPath on success', async () => {
            const result = await dcmscale('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.outputPath).toBe('/output.dcm');
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'scaling failed', exitCode: 1 },
            });
            const result = await dcmscale('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dcmscale('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcmscale('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });
    });
});
