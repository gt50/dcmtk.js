import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmqridx } from './dcmqridx';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmqridx' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcmqridx', () => {
    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await dcmqridx({ indexDirectory: '/db', inputFiles: ['/file.dcm'], verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await dcmqridx({ indexDirectory: '/db', inputFiles: ['/file.dcm'], verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dcmqridx({ indexDirectory: '/db', inputFiles: ['/file.dcm'] });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });
    });

    describe('result handling', () => {
        it('returns register mode on success with inputFiles', async () => {
            const result = await dcmqridx({ indexDirectory: '/db', inputFiles: ['/file.dcm'] });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.mode).toBe('register');
            }
        });

        it('returns print mode with output on success with print flag', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: 'db contents here', stderr: '', exitCode: 0 },
            });
            const result = await dcmqridx({ indexDirectory: '/db', print: true });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.mode).toBe('print');
                if (result.value.mode === 'print') {
                    expect(result.value.output).toBe('db contents here');
                }
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'index failed', exitCode: 1 },
            });
            const result = await dcmqridx({ indexDirectory: '/db', inputFiles: ['/file.dcm'] });
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('not found') });
            const result = await dcmqridx({ indexDirectory: '/db', inputFiles: ['/file.dcm'] });
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({ ok: false, error: new Error('exec failed') });
            const result = await dcmqridx({ indexDirectory: '/db', inputFiles: ['/file.dcm'] });
            expect(result.ok).toBe(false);
        });
    });
});
