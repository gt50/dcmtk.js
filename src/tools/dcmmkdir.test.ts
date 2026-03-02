import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmmkdir } from './dcmmkdir';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmmkdir' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcmmkdir', () => {
    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await dcmmkdir({ inputFiles: ['/file.dcm'], verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await dcmmkdir({ inputFiles: ['/file.dcm'], verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dcmmkdir({ inputFiles: ['/file.dcm'] });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });
    });

    describe('result handling', () => {
        it('returns outputPath on success', async () => {
            const result = await dcmmkdir({ inputFiles: ['/file.dcm'], outputFile: '/out/DICOMDIR' });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.outputPath).toBe('/out/DICOMDIR');
            }
        });

        it('defaults outputPath to DICOMDIR when outputFile not specified', async () => {
            const result = await dcmmkdir({ inputFiles: ['/file.dcm'] });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.outputPath).toBe('DICOMDIR');
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'creation failed', exitCode: 1 },
            });
            const result = await dcmmkdir({ inputFiles: ['/file.dcm'] });
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('not found') });
            const result = await dcmmkdir({ inputFiles: ['/file.dcm'] });
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({ ok: false, error: new Error('exec failed') });
            const result = await dcmmkdir({ inputFiles: ['/file.dcm'] });
            expect(result.ok).toBe(false);
        });
    });
});
