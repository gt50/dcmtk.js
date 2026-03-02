import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmftest } from './dcmftest';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmftest' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: 'yes: /input.dcm', stderr: '', exitCode: 0 },
    });
});

describe('dcmftest', () => {
    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await dcmftest('/input.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await dcmftest('/input.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dcmftest('/input.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });
    });

    describe('result handling', () => {
        it('returns isDicom true when stdout contains yes:', async () => {
            const result = await dcmftest('/input.dcm');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.isDicom).toBe(true);
            }
        });

        it('returns isDicom false when stdout contains no:', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: 'no: /input.txt', stderr: '', exitCode: 0 },
            });
            const result = await dcmftest('/input.txt');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.isDicom).toBe(false);
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'error', exitCode: 1 },
            });
            const result = await dcmftest('/input.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('not found') });
            const result = await dcmftest('/input.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({ ok: false, error: new Error('exec failed') });
            const result = await dcmftest('/input.dcm');
            expect(result.ok).toBe(false);
        });
    });
});
