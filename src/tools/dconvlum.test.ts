import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dconvlum } from './dconvlum';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dconvlum' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dconvlum', () => {
    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await dconvlum('/input.dat', '/output.dat', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await dconvlum('/input.dat', '/output.dat', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dconvlum('/input.dat', '/output.dat');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes +Ca with ambient light value', async () => {
            await dconvlum('/input.dat', '/output.dat', { ambientLight: 10 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+Ca');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('10');
        });

        it('includes input and output paths at the end', async () => {
            await dconvlum('/input.dat', '/output.dat');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 2]).toBe('/input.dat');
            expect(args[args.length - 1]).toBe('/output.dat');
        });
    });

    describe('validation', () => {
        it('rejects non-positive ambientLight', async () => {
            const result = await dconvlum('/input.dat', '/output.dat', { ambientLight: 0 });
            expect(result.ok).toBe(false);
        });

        it('accepts valid ambientLight', async () => {
            const result = await dconvlum('/input.dat', '/output.dat', { ambientLight: 5 });
            expect(result.ok).toBe(true);
        });
    });

    describe('result handling', () => {
        it('returns outputPath on success', async () => {
            const result = await dconvlum('/input.dat', '/output.dat');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.outputPath).toBe('/output.dat');
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'conversion failed', exitCode: 1 },
            });
            const result = await dconvlum('/input.dat', '/output.dat');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dconvlum('/input.dat', '/output.dat');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dconvlum('/input.dat', '/output.dat');
            expect(result.ok).toBe(false);
        });
    });
});
