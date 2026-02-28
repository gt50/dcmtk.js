import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storescu, ProposedTransferSyntax } from './storescu';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/storescu' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('storescu', () => {
    describe('validation', () => {
        it('rejects missing host', async () => {
            const result = await storescu({ host: '', port: 104, files: ['/test.dcm'] });
            expect(result.ok).toBe(false);
        });

        it('rejects empty files array', async () => {
            const result = await storescu({ host: 'localhost', port: 104, files: [] });
            expect(result.ok).toBe(false);
        });

        it('rejects invalid port', async () => {
            const result = await storescu({ host: 'localhost', port: 0, files: ['/test.dcm'] });
            expect(result.ok).toBe(false);
        });

        it('rejects invalid proposed transfer syntax', async () => {
            const result = await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: 'invalid' as never,
            });
            expect(result.ok).toBe(false);
        });

        it('accepts valid proposed transfer syntax', async () => {
            const result = await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.JPEG_LOSSLESS,
            });
            expect(result.ok).toBe(true);
        });
    });

    describe('argument building', () => {
        it('passes proposed transfer syntax flag -xs for JPEG_LOSSLESS', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.JPEG_LOSSLESS,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-xs');
        });

        it('passes -x= for UNCOMPRESSED', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.UNCOMPRESSED,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-x=');
        });

        it('passes -xe for LITTLE_ENDIAN', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.LITTLE_ENDIAN,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-xe');
        });

        it('passes -xb for BIG_ENDIAN', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.BIG_ENDIAN,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-xb');
        });

        it('passes -xi for IMPLICIT_VR', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.IMPLICIT_VR,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-xi');
        });

        it('passes -xy for JPEG_8BIT', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.JPEG_8BIT,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-xy');
        });

        it('passes -xx for JPEG_12BIT', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.JPEG_12BIT,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-xx');
        });

        it('passes -xv for J2K_LOSSLESS', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.J2K_LOSSLESS,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-xv');
        });

        it('passes -xw for J2K_LOSSY', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.J2K_LOSSY,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-xw');
        });

        it('passes -xt for JLS_LOSSLESS', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.JLS_LOSSLESS,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-xt');
        });

        it('passes -xu for JLS_LOSSY', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.JLS_LOSSY,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-xu');
        });

        it('omits transfer syntax flag when not specified', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const tsFlags = ['-x=', '-xe', '-xb', '-xi', '-xs', '-xy', '-xx', '-xv', '-xw', '-xt', '-xu'];
            for (const flag of tsFlags) {
                expect(args).not.toContain(flag);
            }
        });

        it('includes host, port, and files after transfer syntax flag', async () => {
            await storescu({
                host: 'pacs.example.com',
                port: 11112,
                files: ['/study.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.JPEG_LOSSLESS,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const hostIdx = args.indexOf('pacs.example.com');
            const tsIdx = args.indexOf('-xs');
            expect(tsIdx).toBeLessThan(hostIdx);
        });

        it('includes AE title flags', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                callingAETitle: 'MYSCU',
                calledAETitle: 'PACS',
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-aet');
            expect(args).toContain('MYSCU');
            expect(args).toContain('-aec');
            expect(args).toContain('PACS');
        });
    });

    describe('result handling', () => {
        it('returns success on exit code 0', async () => {
            const result = await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'] });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.success).toBe(true);
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'connection refused', exitCode: 1 },
            });
            const result = await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'] });
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'] });
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'] });
            expect(result.ok).toBe(false);
        });
    });

    describe('ProposedTransferSyntax constants', () => {
        it('has all 11 values', () => {
            expect(Object.keys(ProposedTransferSyntax)).toHaveLength(11);
        });

        it('values are unique strings', () => {
            const values = Object.values(ProposedTransferSyntax);
            expect(new Set(values).size).toBe(values.length);
        });
    });
});
