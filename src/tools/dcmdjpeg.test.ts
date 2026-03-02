import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmdjpeg, ColorConversion } from './dcmdjpeg';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmdjpeg' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcmdjpeg', () => {
    describe('argument building', () => {
        it('passes -v for verbose', async () => {
            await dcmdjpeg('/input.dcm', '/output.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug', async () => {
            await dcmdjpeg('/input.dcm', '/output.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity when not specified', async () => {
            await dcmdjpeg('/input.dcm', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes +cp for photometric color conversion', async () => {
            await dcmdjpeg('/input.dcm', '/output.dcm', { colorConversion: ColorConversion.PHOTOMETRIC });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+cp');
        });

        it('passes +ca for always color conversion', async () => {
            await dcmdjpeg('/input.dcm', '/output.dcm', { colorConversion: ColorConversion.ALWAYS });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+ca');
        });

        it('passes +cn for never color conversion', async () => {
            await dcmdjpeg('/input.dcm', '/output.dcm', { colorConversion: ColorConversion.NEVER });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+cn');
        });

        it('includes input and output paths at the end', async () => {
            await dcmdjpeg('/input.dcm', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 2]).toBe('/input.dcm');
            expect(args[args.length - 1]).toBe('/output.dcm');
        });
    });

    describe('result handling', () => {
        it('returns outputPath on success', async () => {
            const result = await dcmdjpeg('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.outputPath).toBe('/output.dcm');
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'decompression failed', exitCode: 1 },
            });
            const result = await dcmdjpeg('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dcmdjpeg('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcmdjpeg('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });
    });

    describe('ColorConversion constants', () => {
        it('has all 3 values', () => {
            expect(Object.keys(ColorConversion)).toHaveLength(3);
        });

        it('values are unique strings', () => {
            const values = Object.values(ColorConversion);
            expect(new Set(values).size).toBe(values.length);
        });
    });
});
