import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storescu, ProposedTransferSyntax } from './storescu';
import { ToolExecutionError } from './_toolError';

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

        it('rejects maxPduReceive below 4096', async () => {
            const result = await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], maxPduReceive: 1024 });
            expect(result.ok).toBe(false);
        });

        it('rejects maxPduReceive above 131072', async () => {
            const result = await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], maxPduReceive: 200000 });
            expect(result.ok).toBe(false);
        });

        it('rejects maxPduSend below 4096', async () => {
            const result = await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], maxPduSend: 100 });
            expect(result.ok).toBe(false);
        });

        it('rejects maxPduSend above 131072', async () => {
            const result = await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], maxPduSend: 999999 });
            expect(result.ok).toBe(false);
        });

        it('rejects associationTimeout less than 1', async () => {
            const result = await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], associationTimeout: 0 });
            expect(result.ok).toBe(false);
        });

        it('rejects acseTimeout less than 1', async () => {
            const result = await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], acseTimeout: 0 });
            expect(result.ok).toBe(false);
        });

        it('rejects dimseTimeout less than 1', async () => {
            const result = await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], dimseTimeout: 0 });
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
            const tsFlags = [
                '-x=',
                '-xe',
                '-xb',
                '-xi',
                '-xs',
                '-xy',
                '-xx',
                '-xv',
                '-xw',
                '-xt',
                '-xu',
                '-xm',
                '-xh',
                '-xn',
                '-xl',
                '-x2',
                '-x3',
                '-xo',
                '-x4',
                '-x5',
                '-xr',
                '-xd',
                '+C',
            ];
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

        it('passes -v for verbose verbosity', async () => {
            await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'] });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes --max-pdu with value for maxPduReceive', async () => {
            await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], maxPduReceive: 16384 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('--max-pdu');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('16384');
        });

        it('passes --max-send-pdu with value for maxPduSend', async () => {
            await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], maxPduSend: 65536 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('--max-send-pdu');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('65536');
        });

        it('passes -to with value for associationTimeout', async () => {
            await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], associationTimeout: 30 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-to');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('30');
        });

        it('passes -ta with value for acseTimeout', async () => {
            await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], acseTimeout: 15 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-ta');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('15');
        });

        it('passes -td with value for dimseTimeout', async () => {
            await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], dimseTimeout: 60 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-td');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('60');
        });

        it('passes -nh for noHostnameLookup', async () => {
            await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], noHostnameLookup: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-nh');
        });

        it('passes -R for required', async () => {
            await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'], required: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-R');
        });

        it('omits network flags when not specified', async () => {
            await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'] });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
            expect(args).not.toContain('--max-pdu');
            expect(args).not.toContain('--max-send-pdu');
            expect(args).not.toContain('-to');
            expect(args).not.toContain('-ta');
            expect(args).not.toContain('-td');
            expect(args).not.toContain('-nh');
            expect(args).not.toContain('-R');
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

        it('attaches stdout and stderr to ToolExecutionError on non-zero exit', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: 'I: starting association', stderr: 'F: connection refused', exitCode: 3 },
            });
            const result = await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'] });
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error).toBeInstanceOf(ToolExecutionError);
            const err = result.error as ToolExecutionError;
            expect(err.stdout).toBe('I: starting association');
            expect(err.stderr).toBe('F: connection refused');
            expect(err.exitCode).toBe(3);
        });

        it('attaches stdout and stderr to ToolExecutionError on DIMSE failure with exit code 0', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: 'I: progress', stderr: 'E: DIMSE Failed status: 0xa700', exitCode: 0 },
            });
            const result = await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'] });
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error).toBeInstanceOf(ToolExecutionError);
            const err = result.error as ToolExecutionError;
            expect(err.stdout).toBe('I: progress');
            expect(err.stderr).toBe('E: DIMSE Failed status: 0xa700');
            expect(err.exitCode).toBe(0);
        });

        it('returns error when stderr contains DIMSE failure despite exit code 0', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: {
                    stdout: '',
                    stderr: 'E: Store Failed, file: /tmp/test.dcm\nE: 0006:020e DIMSE Failed to send message',
                    exitCode: 0,
                },
            });
            const result = await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'] });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toContain('DIMSE Failed');
            }
        });

        it('returns success when stderr has warnings but no DIMSE errors', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: {
                    stdout: '',
                    stderr: 'W: some warning about something',
                    exitCode: 0,
                },
            });
            const result = await storescu({ host: 'localhost', port: 104, files: ['/test.dcm'] });
            expect(result.ok).toBe(true);
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

    describe('array proposedTransferSyntax', () => {
        it('passes multiple transfer syntax flags for array input', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: [ProposedTransferSyntax.JPEG_LOSSLESS, ProposedTransferSyntax.J2K_LOSSLESS],
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-xs');
            expect(args).toContain('-xv');
        });

        it('passes +C for combineProposedTransferSyntaxes', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: [ProposedTransferSyntax.JPEG_LOSSLESS, ProposedTransferSyntax.J2K_LOSSLESS],
                combineProposedTransferSyntaxes: true,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+C');
        });

        it('omits +C when combineProposedTransferSyntaxes is not set', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.JPEG_LOSSLESS,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('+C');
        });

        it('rejects empty array', async () => {
            const result = await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: [] as never,
            });
            expect(result.ok).toBe(false);
        });
    });

    describe('additional transfer syntax values', () => {
        it('passes -xm for MPEG2', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.MPEG2,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-xm');
        });

        it('passes -xr for RLE', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.RLE,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-xr');
        });

        it('passes -xd for DEFLATED', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.DEFLATED,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-xd');
        });

        it('passes -x4 for HEVC', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.HEVC,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-x4');
        });

        it('passes -x5 for HEVC10', async () => {
            await storescu({
                host: 'localhost',
                port: 104,
                files: ['/test.dcm'],
                proposedTransferSyntax: ProposedTransferSyntax.HEVC10,
            });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-x5');
        });
    });

    describe('ProposedTransferSyntax constants', () => {
        it('has all 22 values', () => {
            expect(Object.keys(ProposedTransferSyntax)).toHaveLength(22);
        });

        it('values are unique strings', () => {
            const values = Object.values(ProposedTransferSyntax);
            expect(new Set(values).size).toBe(values.length);
        });
    });
});
