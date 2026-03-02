import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmdjpls, JplsColorConversion } from './dcmdjpls';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmdjpls' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcmdjpls', () => {
    describe('argument building', () => {
        it('passes -v for verbose', async () => {
            await dcmdjpls('/input.dcm', '/output.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug', async () => {
            await dcmdjpls('/input.dcm', '/output.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity when not specified', async () => {
            await dcmdjpls('/input.dcm', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes +cp for photometric color conversion', async () => {
            await dcmdjpls('/input.dcm', '/output.dcm', { colorConversion: JplsColorConversion.PHOTOMETRIC });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+cp');
        });

        it('passes +ca for always color conversion', async () => {
            await dcmdjpls('/input.dcm', '/output.dcm', { colorConversion: JplsColorConversion.ALWAYS });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+ca');
        });

        it('passes +cn for never color conversion', async () => {
            await dcmdjpls('/input.dcm', '/output.dcm', { colorConversion: JplsColorConversion.NEVER });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+cn');
        });

        it('includes input and output paths at the end', async () => {
            await dcmdjpls('/input.dcm', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 2]).toBe('/input.dcm');
            expect(args[args.length - 1]).toBe('/output.dcm');
        });
    });

    describe('result handling', () => {
        it('returns outputPath on success', async () => {
            const result = await dcmdjpls('/input.dcm', '/output.dcm');
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
            const result = await dcmdjpls('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dcmdjpls('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcmdjpls('/input.dcm', '/output.dcm');
            expect(result.ok).toBe(false);
        });
    });

    describe('JplsColorConversion constants', () => {
        it('has all 3 values', () => {
            expect(Object.keys(JplsColorConversion)).toHaveLength(3);
        });

        it('values are unique strings', () => {
            const values = Object.values(JplsColorConversion);
            expect(new Set(values).size).toBe(values.length);
        });
    });
});
