import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmpsprt } from './dcmpsprt';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmpsprt' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: 'print output', stderr: '', exitCode: 0 },
    });
});

describe('dcmpsprt', () => {
    describe('argument building', () => {
        it('passes -v for verbose', async () => {
            await dcmpsprt('/printjob.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug', async () => {
            await dcmpsprt('/printjob.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity when not specified', async () => {
            await dcmpsprt('/printjob.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes -c with configFile', async () => {
            await dcmpsprt('/printjob.dcm', { configFile: '/etc/dcmpsprt.cfg' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-c');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('/etc/dcmpsprt.cfg');
        });

        it('includes input path at the end', async () => {
            await dcmpsprt('/printjob.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 1]).toBe('/printjob.dcm');
        });
    });

    describe('result handling', () => {
        it('returns text on success', async () => {
            const result = await dcmpsprt('/printjob.dcm');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.text).toBe('print output');
            }
        });

        it('returns error on non-zero exit', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'print error', exitCode: 1 },
            });
            const result = await dcmpsprt('/printjob.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dcmpsprt('/printjob.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcmpsprt('/printjob.dcm');
            expect(result.ok).toBe(false);
        });
    });
});
