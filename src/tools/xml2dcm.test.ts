import { describe, it, expect, vi, beforeEach } from 'vitest';
import { xml2dcm } from './xml2dcm';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/xml2dcm' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('xml2dcm', () => {
    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await xml2dcm('/input.xml', '/output.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await xml2dcm('/input.xml', '/output.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await xml2dcm('/input.xml', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes +Ug for generateNewUIDs', async () => {
            await xml2dcm('/input.xml', '/output.dcm', { generateNewUIDs: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+Ug');
        });

        it('passes +Vd for validateDocument', async () => {
            await xml2dcm('/input.xml', '/output.dcm', { validateDocument: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+Vd');
        });

        it('includes input and output paths at the end', async () => {
            await xml2dcm('/input.xml', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 2]).toBe('/input.xml');
            expect(args[args.length - 1]).toBe('/output.dcm');
        });

        it('omits optional flags when not specified', async () => {
            await xml2dcm('/input.xml', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('+Ug');
            expect(args).not.toContain('+Vd');
        });
    });

    describe('result handling', () => {
        it('returns outputPath on success', async () => {
            const result = await xml2dcm('/input.xml', '/output.dcm');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.outputPath).toBe('/output.dcm');
            }
        });

        it('returns error on non-zero exit', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'cannot read file', exitCode: 1 },
            });
            const result = await xml2dcm('/input.xml', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await xml2dcm('/input.xml', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await xml2dcm('/input.xml', '/output.dcm');
            expect(result.ok).toBe(false);
        });
    });
});
