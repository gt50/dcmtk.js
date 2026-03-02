import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmprscu } from './dcmprscu';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmprscu' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcmprscu', () => {
    describe('argument building', () => {
        it('passes -v for verbose', async () => {
            await dcmprscu({ host: 'localhost', port: 104, verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug', async () => {
            await dcmprscu({ host: 'localhost', port: 104, verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity when not specified', async () => {
            await dcmprscu({ host: 'localhost', port: 104 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes -aet with callingAETitle', async () => {
            await dcmprscu({ host: 'localhost', port: 104, callingAETitle: 'MYSCU' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-aet');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('MYSCU');
        });

        it('passes -aec with calledAETitle', async () => {
            await dcmprscu({ host: 'localhost', port: 104, calledAETitle: 'PRINTER' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-aec');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('PRINTER');
        });

        it('passes -c with configFile', async () => {
            await dcmprscu({ host: 'localhost', port: 104, configFile: '/etc/dcmprscu.cfg' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-c');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('/etc/dcmprscu.cfg');
        });

        it('includes host and port at the end', async () => {
            await dcmprscu({ host: '192.168.1.100', port: 104 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 2]).toBe('192.168.1.100');
            expect(args[args.length - 1]).toBe('104');
        });
    });

    describe('validation', () => {
        it('rejects empty host', async () => {
            const result = await dcmprscu({ host: '', port: 104 });
            expect(result.ok).toBe(false);
        });

        it('rejects invalid port', async () => {
            const result = await dcmprscu({ host: 'localhost', port: 0 });
            expect(result.ok).toBe(false);
        });
    });

    describe('result handling', () => {
        it('returns success', async () => {
            const result = await dcmprscu({ host: 'localhost', port: 104 });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.success).toBe(true);
            }
        });

        it('returns error on non-zero exit', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'connection refused', exitCode: 1 },
            });
            const result = await dcmprscu({ host: 'localhost', port: 104 });
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dcmprscu({ host: 'localhost', port: 104 });
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcmprscu({ host: 'localhost', port: 104 });
            expect(result.ok).toBe(false);
        });
    });
});
