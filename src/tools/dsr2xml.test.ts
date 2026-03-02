import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dsr2xml } from './dsr2xml';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dsr2xml' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '<xml>report</xml>', stderr: '', exitCode: 0 },
    });
});

describe('dsr2xml', () => {
    describe('validation', () => {
        it('rejects empty charsetAssume', async () => {
            const result = await dsr2xml('/report.dcm', { charsetAssume: '' });
            expect(result.ok).toBe(false);
        });

        it('accepts valid charsetAssume', async () => {
            const result = await dsr2xml('/report.dcm', { charsetAssume: 'ISO_IR 100' });
            expect(result.ok).toBe(true);
        });

        it('accepts no options', async () => {
            const result = await dsr2xml('/report.dcm');
            expect(result.ok).toBe(true);
        });
    });

    describe('argument building', () => {
        it('passes +Ca with charset value', async () => {
            await dsr2xml('/report.dcm', { charsetAssume: 'ISO_IR 100' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+Ca');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('ISO_IR 100');
        });

        it('passes +Xn for useNamespace', async () => {
            await dsr2xml('/report.dcm', { useNamespace: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+Xn');
        });

        it('passes +Xs for addSchemaRef', async () => {
            await dsr2xml('/report.dcm', { addSchemaRef: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+Xs');
        });

        it('passes -v for verbose verbosity', async () => {
            await dsr2xml('/report.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await dsr2xml('/report.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dsr2xml('/report.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('includes input path at the end', async () => {
            await dsr2xml('/report.dcm', { charsetAssume: 'UTF-8' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 1]).toBe('/report.dcm');
        });

        it('omits +Ca when charsetAssume not specified', async () => {
            await dsr2xml('/report.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('+Ca');
        });
    });

    describe('result handling', () => {
        it('returns text on exit code 0', async () => {
            const result = await dsr2xml('/report.dcm');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.text).toBe('<xml>report</xml>');
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'cannot read file', exitCode: 1 },
            });
            const result = await dsr2xml('/report.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dsr2xml('/report.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dsr2xml('/report.dcm');
            expect(result.ok).toBe(false);
        });
    });
});
