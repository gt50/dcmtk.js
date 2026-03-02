import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmquant } from './dcmquant';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmquant' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcmquant', () => {
    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await dcmquant('/input.dcm', '/output.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await dcmquant('/input.dcm', '/output.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dcmquant('/input.dcm', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes +pc with colors value', async () => {
            await dcmquant('/input.dcm', '/output.dcm', { colors: 256 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+pc');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('256');
        });

        it('passes +F with frame number', async () => {
            await dcmquant('/input.dcm', '/output.dcm', { frame: 3 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+F');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('3');
        });

        it('includes input and output paths at the end', async () => {
            await dcmquant('/input.dcm', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 2]).toBe('/input.dcm');
            expect(args[args.length - 1]).toBe('/output.dcm');
        });
    });

    describe('validation', () => {
        it('rejects colors below 2', async () => {
            const result = await dcmquant('/input.dcm', '/output.dcm', { colors: 1 });
            expect(result.ok).toBe(false);
        });

        it('rejects colors above 65536', async () => {
            const result = await dcmquant('/input.dcm', '/output.dcm', { colors: 65537 });
            expect(result.ok).toBe(false);
        });

        it('accepts valid colors', async () => {
            const result = await dcmquant('/input.dcm', '/output.dcm', { colors: 256 });
            expect(result.ok).toBe(true);
        });
    });

    describe('result handling', () => {
        it('returns outputPath on success', async () => {
            const result = await dcmquant('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.outputPath).toBe('/output.dcm');
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'quantization failed', exitCode: 1 },
            });
            const result = await dcmquant('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dcmquant('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcmquant('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });
    });
});
