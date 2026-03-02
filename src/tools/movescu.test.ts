import { describe, it, expect, vi, beforeEach } from 'vitest';
import { movescu } from './movescu';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/movescu' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('movescu', () => {
    describe('validation', () => {
        it('rejects missing host', async () => {
            const result = await movescu({ host: '', port: 104 });
            expect(result.ok).toBe(false);
        });

        it('rejects invalid port', async () => {
            const result = await movescu({ host: 'localhost', port: 0 });
            expect(result.ok).toBe(false);
        });

        it('rejects maxPduReceive below 4096', async () => {
            const result = await movescu({ host: 'localhost', port: 104, maxPduReceive: 1024 });
            expect(result.ok).toBe(false);
        });

        it('rejects maxPduReceive above 131072', async () => {
            const result = await movescu({ host: 'localhost', port: 104, maxPduReceive: 200000 });
            expect(result.ok).toBe(false);
        });

        it('rejects maxPduSend below 4096', async () => {
            const result = await movescu({ host: 'localhost', port: 104, maxPduSend: 100 });
            expect(result.ok).toBe(false);
        });

        it('rejects maxPduSend above 131072', async () => {
            const result = await movescu({ host: 'localhost', port: 104, maxPduSend: 999999 });
            expect(result.ok).toBe(false);
        });

        it('rejects associationTimeout less than 1', async () => {
            const result = await movescu({ host: 'localhost', port: 104, associationTimeout: 0 });
            expect(result.ok).toBe(false);
        });

        it('rejects acseTimeout less than 1', async () => {
            const result = await movescu({ host: 'localhost', port: 104, acseTimeout: 0 });
            expect(result.ok).toBe(false);
        });

        it('rejects dimseTimeout less than 1', async () => {
            const result = await movescu({ host: 'localhost', port: 104, dimseTimeout: 0 });
            expect(result.ok).toBe(false);
        });
    });

    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await movescu({ host: 'localhost', port: 104, verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await movescu({ host: 'localhost', port: 104, verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await movescu({ host: 'localhost', port: 104 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes --max-pdu with value for maxPduReceive', async () => {
            await movescu({ host: 'localhost', port: 104, maxPduReceive: 16384 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('--max-pdu');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('16384');
        });

        it('passes --max-send-pdu with value for maxPduSend', async () => {
            await movescu({ host: 'localhost', port: 104, maxPduSend: 65536 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('--max-send-pdu');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('65536');
        });

        it('passes -to with value for associationTimeout', async () => {
            await movescu({ host: 'localhost', port: 104, associationTimeout: 30 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-to');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('30');
        });

        it('passes -ta with value for acseTimeout', async () => {
            await movescu({ host: 'localhost', port: 104, acseTimeout: 15 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-ta');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('15');
        });

        it('passes -td with value for dimseTimeout', async () => {
            await movescu({ host: 'localhost', port: 104, dimseTimeout: 60 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-td');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('60');
        });

        it('passes -nh for noHostnameLookup', async () => {
            await movescu({ host: 'localhost', port: 104, noHostnameLookup: true });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-nh');
        });

        it('passes query model flag', async () => {
            await movescu({ host: 'localhost', port: 104, queryModel: 'study' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-S');
        });

        it('passes -k for each key', async () => {
            await movescu({ host: 'localhost', port: 104, keys: ['0020,000D=1.2.3.4'] });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-k');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('0020,000D=1.2.3.4');
        });

        it('passes -aem for moveDestination', async () => {
            await movescu({ host: 'localhost', port: 104, moveDestination: 'LOCALAE' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-aem');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('LOCALAE');
        });

        it('includes AE title flags', async () => {
            await movescu({ host: 'localhost', port: 104, callingAETitle: 'MYSCU', calledAETitle: 'PACS' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-aet');
            expect(args).toContain('MYSCU');
            expect(args).toContain('-aec');
            expect(args).toContain('PACS');
        });

        it('omits optional flags when not specified', async () => {
            await movescu({ host: 'localhost', port: 104 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
            expect(args).not.toContain('--max-pdu');
            expect(args).not.toContain('--max-send-pdu');
            expect(args).not.toContain('-to');
            expect(args).not.toContain('-ta');
            expect(args).not.toContain('-td');
            expect(args).not.toContain('-nh');
        });
    });

    describe('result handling', () => {
        it('returns success on exit code 0', async () => {
            const result = await movescu({ host: 'localhost', port: 104 });
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
            const result = await movescu({ host: 'localhost', port: 104 });
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await movescu({ host: 'localhost', port: 104 });
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await movescu({ host: 'localhost', port: 104 });
            expect(result.ok).toBe(false);
        });
    });
});
