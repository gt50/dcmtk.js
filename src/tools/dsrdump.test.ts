import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dsrdump } from './dsrdump';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dsrdump' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: 'SR dump output', stderr: '', exitCode: 0 },
    });
});

describe('dsrdump', () => {
    describe('validation', () => {
        it('rejects empty charsetAssume', async () => {
            const result = await dsrdump('/report.dcm', { charsetAssume: '' });
            expect(result.ok).toBe(false);
        });

        it('accepts valid charsetAssume', async () => {
            const result = await dsrdump('/report.dcm', { charsetAssume: 'ISO_IR 100' });
            expect(result.ok).toBe(true);
        });

        it('accepts no options', async () => {
            const result = await dsrdump('/report.dcm');
            expect(result.ok).toBe(true);
        });
    });

    describe('argument building', () => {
        it('passes +Ca with charset value', async () => {
            await dsrdump('/report.dcm', { charsetAssume: 'ISO_IR 100' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+Ca');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('ISO_IR 100');
        });

        it('passes +Pf for printFilename', async () => {
            await dsrdump('/report.dcm', { printFilename: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+Pf');
        });

        it('passes +Pl for printLong', async () => {
            await dsrdump('/report.dcm', { printLong: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+Pl');
        });

        it('passes +Pc for printCodes', async () => {
            await dsrdump('/report.dcm', { printCodes: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+Pc');
        });

        it('passes -v for verbose verbosity', async () => {
            await dsrdump('/report.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await dsrdump('/report.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dsrdump('/report.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('includes input path at the end', async () => {
            await dsrdump('/report.dcm', { charsetAssume: 'UTF-8' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 1]).toBe('/report.dcm');
        });

        it('omits +Ca when charsetAssume not specified', async () => {
            await dsrdump('/report.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('+Ca');
        });
    });

    describe('result handling', () => {
        it('returns text on exit code 0', async () => {
            const result = await dsrdump('/report.dcm');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.text).toBe('SR dump output');
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'cannot read file', exitCode: 1 },
            });
            const result = await dsrdump('/report.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dsrdump('/report.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dsrdump('/report.dcm');
            expect(result.ok).toBe(false);
        });
    });
});
