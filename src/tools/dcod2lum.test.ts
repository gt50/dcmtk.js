import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcod2lum } from './dcod2lum';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcod2lum' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcod2lum', () => {
    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await dcod2lum('/input.dat', '/output.dat', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await dcod2lum('/input.dat', '/output.dat', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dcod2lum('/input.dat', '/output.dat');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('includes input and output paths at the end', async () => {
            await dcod2lum('/input.dat', '/output.dat');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 2]).toBe('/input.dat');
            expect(args[args.length - 1]).toBe('/output.dat');
        });
    });

    describe('result handling', () => {
        it('returns outputPath on success', async () => {
            const result = await dcod2lum('/input.dat', '/output.dat');
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
            const result = await dcod2lum('/input.dat', '/output.dat');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dcod2lum('/input.dat', '/output.dat');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcod2lum('/input.dat', '/output.dat');
            expect(result.ok).toBe(false);
        });
    });
});
