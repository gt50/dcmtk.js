import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcm2cda } from './dcm2cda';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcm2cda' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcm2cda', () => {
    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await dcm2cda('/input.dcm', '/output.cda', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await dcm2cda('/input.dcm', '/output.cda', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dcm2cda('/input.dcm', '/output.cda');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('includes input and output paths at the end', async () => {
            await dcm2cda('/input.dcm', '/output.cda');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 2]).toBe('/input.dcm');
            expect(args[args.length - 1]).toBe('/output.cda');
        });
    });

    describe('result handling', () => {
        it('returns outputPath on success', async () => {
            const result = await dcm2cda('/input.dcm', '/output.cda');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.outputPath).toBe('/output.cda');
            }
        });

        it('returns error on non-zero exit', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'cannot read file', exitCode: 1 },
            });
            const result = await dcm2cda('/input.dcm', '/output.cda');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dcm2cda('/input.dcm', '/output.cda');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcm2cda('/input.dcm', '/output.cda');
            expect(result.ok).toBe(false);
        });
    });
});
