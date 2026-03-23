import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcm2xml } from './dcm2xml';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcm2xml' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '<xml/>', stderr: '', exitCode: 0 },
    });
});

describe('dcm2xml', () => {
    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await dcm2xml('/input.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await dcm2xml('/input.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dcm2xml('/input.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes +Ca with charset value for charsetAssume', async () => {
            await dcm2xml('/input.dcm', { charsetAssume: 'ISO_IR 100' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+Ca');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('ISO_IR 100');
        });

        it('omits +Ca when charsetAssume not specified', async () => {
            await dcm2xml('/input.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('+Ca');
        });
    });

    describe('validation', () => {
        it('rejects empty charsetAssume', async () => {
            const result = await dcm2xml('/input.dcm', { charsetAssume: '' });
            expect(result.ok).toBe(false);
        });

        it('accepts valid charsetAssume', async () => {
            const result = await dcm2xml('/input.dcm', { charsetAssume: 'Latin1' });
            expect(result.ok).toBe(true);
        });
    });

    describe('result handling', () => {
        it('returns xml on success', async () => {
            const result = await dcm2xml('/input.dcm');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.xml).toBe('<xml/>');
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'error', exitCode: 1 },
            });
            const result = await dcm2xml('/input.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('not found') });
            const result = await dcm2xml('/input.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({ ok: false, error: new Error('exec failed') });
            const result = await dcm2xml('/input.dcm');
            expect(result.ok).toBe(false);
        });
    });
});
