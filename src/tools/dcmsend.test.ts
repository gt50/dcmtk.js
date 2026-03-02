import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmsend } from './dcmsend';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmsend' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: 'sent 1 file', stderr: '', exitCode: 0 },
    });
});

describe('dcmsend', () => {
    describe('validation', () => {
        it('rejects missing host', async () => {
            const result = await dcmsend({ host: '', port: 104, files: ['/test.dcm'] });
            expect(result.ok).toBe(false);
        });

        it('rejects empty files array', async () => {
            const result = await dcmsend({ host: 'localhost', port: 104, files: [] });
            expect(result.ok).toBe(false);
        });

        it('rejects invalid port', async () => {
            const result = await dcmsend({ host: 'localhost', port: 0, files: ['/test.dcm'] });
            expect(result.ok).toBe(false);
        });

        it('rejects maxPduReceive below 4096', async () => {
            const result = await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'], maxPduReceive: 1024 });
            expect(result.ok).toBe(false);
        });

        it('rejects maxPduReceive above 131072', async () => {
            const result = await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'], maxPduReceive: 200000 });
            expect(result.ok).toBe(false);
        });

        it('rejects maxPduSend below 4096', async () => {
            const result = await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'], maxPduSend: 100 });
            expect(result.ok).toBe(false);
        });

        it('rejects maxPduSend above 131072', async () => {
            const result = await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'], maxPduSend: 999999 });
            expect(result.ok).toBe(false);
        });

        it('rejects associationTimeout less than 1', async () => {
            const result = await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'], associationTimeout: 0 });
            expect(result.ok).toBe(false);
        });

        it('accepts valid maxPduReceive', async () => {
            const result = await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'], maxPduReceive: 16384 });
            expect(result.ok).toBe(true);
        });

        it('accepts valid maxPduSend', async () => {
            const result = await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'], maxPduSend: 65536 });
            expect(result.ok).toBe(true);
        });

        it('accepts valid associationTimeout', async () => {
            const result = await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'], associationTimeout: 30 });
            expect(result.ok).toBe(true);
        });
    });

    describe('argument building', () => {
        it('passes -v for verbose', async () => {
            await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'], verbose: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes --no-uid-checks for noUidChecks', async () => {
            await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'], noUidChecks: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('--no-uid-checks');
        });

        it('passes --max-pdu with value for maxPduReceive', async () => {
            await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'], maxPduReceive: 16384 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('--max-pdu');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('16384');
        });

        it('passes --max-send-pdu with value for maxPduSend', async () => {
            await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'], maxPduSend: 65536 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('--max-send-pdu');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('65536');
        });

        it('passes -nh for noHostnameLookup', async () => {
            await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'], noHostnameLookup: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-nh');
        });

        it('passes -to with value for associationTimeout', async () => {
            await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'], associationTimeout: 30 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-to');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('30');
        });

        it('includes AE title flags', async () => {
            await dcmsend({
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

        it('includes --scan-directories when scanDirectory is true', async () => {
            await dcmsend({ host: 'localhost', port: 104, files: ['/dir'], scanDirectory: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('--scan-directories');
        });

        it('omits optional flags when not specified', async () => {
            await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'] });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('--no-uid-checks');
            expect(args).not.toContain('--max-pdu');
            expect(args).not.toContain('--max-send-pdu');
            expect(args).not.toContain('-nh');
            expect(args).not.toContain('-to');
        });
    });

    describe('result handling', () => {
        it('returns success with stdout and stderr on exit code 0', async () => {
            const result = await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'] });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.success).toBe(true);
                expect(result.value.stdout).toBe('sent 1 file');
                expect(result.value.stderr).toBe('');
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'connection refused', exitCode: 1 },
            });
            const result = await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'] });
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'] });
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcmsend({ host: 'localhost', port: 104, files: ['/test.dcm'] });
            expect(result.ok).toBe(false);
        });
    });
});
