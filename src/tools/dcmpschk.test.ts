import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmpschk } from './dcmpschk';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmpschk' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: 'check output', stderr: '', exitCode: 0 },
    });
});

describe('dcmpschk', () => {
    describe('argument building', () => {
        it('passes -v for verbose', async () => {
            await dcmpschk('/pstate.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug', async () => {
            await dcmpschk('/pstate.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity when not specified', async () => {
            await dcmpschk('/pstate.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('includes input path at the end', async () => {
            await dcmpschk('/pstate.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 1]).toBe('/pstate.dcm');
        });
    });

    describe('result handling', () => {
        it('returns text on success', async () => {
            const result = await dcmpschk('/pstate.dcm');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.text).toBe('check output');
            }
        });

        it('returns error on non-zero exit', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'invalid pstate', exitCode: 1 },
            });
            const result = await dcmpschk('/pstate.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dcmpschk('/pstate.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcmpschk('/pstate.dcm');
            expect(result.ok).toBe(false);
        });
    });
});
