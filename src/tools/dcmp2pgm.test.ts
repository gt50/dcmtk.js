import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmp2pgm } from './dcmp2pgm';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmp2pgm' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcmp2pgm', () => {
    describe('argument building', () => {
        it('passes -v for verbose', async () => {
            await dcmp2pgm('/input.dcm', '/output.pgm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug', async () => {
            await dcmp2pgm('/input.dcm', '/output.pgm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity when not specified', async () => {
            await dcmp2pgm('/input.dcm', '/output.pgm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes -p with presentation state path', async () => {
            await dcmp2pgm('/input.dcm', '/output.pgm', { presentationState: '/pstate.dcm' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-p');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('/pstate.dcm');
        });

        it('passes -f with frame number', async () => {
            await dcmp2pgm('/input.dcm', '/output.pgm', { frame: 3 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-f');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('3');
        });

        it('includes input and output paths at the end', async () => {
            await dcmp2pgm('/input.dcm', '/output.pgm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 2]).toBe('/input.dcm');
            expect(args[args.length - 1]).toBe('/output.pgm');
        });
    });

    describe('result handling', () => {
        it('returns success with outputPath', async () => {
            const result = await dcmp2pgm('/input.dcm', '/output.pgm');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.outputPath).toBe('/output.pgm');
            }
        });

        it('returns error on non-zero exit', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'cannot read file', exitCode: 1 },
            });
            const result = await dcmp2pgm('/input.dcm', '/output.pgm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dcmp2pgm('/input.dcm', '/output.pgm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcmp2pgm('/input.dcm', '/output.pgm');
            expect(result.ok).toBe(false);
        });
    });
});
