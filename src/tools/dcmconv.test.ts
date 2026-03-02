import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmconv } from './dcmconv';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmconv' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcmconv', () => {
    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await dcmconv('/input.dcm', '/output.dcm', { transferSyntax: '+te', verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await dcmconv('/input.dcm', '/output.dcm', { transferSyntax: '+te', verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dcmconv('/input.dcm', '/output.dcm', { transferSyntax: '+te' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });
    });

    describe('result handling', () => {
        it('returns outputPath on success', async () => {
            const result = await dcmconv('/input.dcm', '/output.dcm', { transferSyntax: '+te' });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.outputPath).toBe('/output.dcm');
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'conversion failed', exitCode: 1 },
            });
            const result = await dcmconv('/input.dcm', '/output.dcm', { transferSyntax: '+te' });
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('not found') });
            const result = await dcmconv('/input.dcm', '/output.dcm', { transferSyntax: '+te' });
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({ ok: false, error: new Error('exec failed') });
            const result = await dcmconv('/input.dcm', '/output.dcm', { transferSyntax: '+te' });
            expect(result.ok).toBe(false);
        });
    });
});
