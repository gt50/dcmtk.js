import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmj2pnm, Dcmj2pnmOutputFormat } from './dcmj2pnm';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcm2img' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcmj2pnm', () => {
    describe('validation', () => {
        it('rejects windowCenter without windowWidth', async () => {
            const result = await dcmj2pnm('/input.dcm', '/output.png', { windowCenter: 128 });
            expect(result.ok).toBe(false);
        });

        it('rejects windowWidth without windowCenter', async () => {
            const result = await dcmj2pnm('/input.dcm', '/output.png', { windowWidth: 256 });
            expect(result.ok).toBe(false);
        });

        it('accepts windowCenter and windowWidth together', async () => {
            const result = await dcmj2pnm('/input.dcm', '/output.png', { windowCenter: 128, windowWidth: 256 });
            expect(result.ok).toBe(true);
        });

        it('accepts all output format values', async () => {
            for (const format of Object.values(Dcmj2pnmOutputFormat)) {
                const result = await dcmj2pnm('/input.dcm', '/output.img', { outputFormat: format });
                expect(result.ok).toBe(true);
            }
        });

        it('rejects invalid output format', async () => {
            const result = await dcmj2pnm('/input.dcm', '/output.img', { outputFormat: 'gif' as never });
            expect(result.ok).toBe(false);
        });
    });

    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await dcmj2pnm('/input.dcm', '/output.png', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await dcmj2pnm('/input.dcm', '/output.png', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dcmj2pnm('/input.dcm', '/output.png');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes +on2 for PNG_16BIT', async () => {
            await dcmj2pnm('/input.dcm', '/output.png', { outputFormat: Dcmj2pnmOutputFormat.PNG_16BIT });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+on2');
        });

        it('passes +on for PNG', async () => {
            await dcmj2pnm('/input.dcm', '/output.png', { outputFormat: Dcmj2pnmOutputFormat.PNG });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+on');
        });

        it('passes +oj for JPEG', async () => {
            await dcmj2pnm('/input.dcm', '/output.jpg', { outputFormat: Dcmj2pnmOutputFormat.JPEG });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+oj');
        });

        it('passes +Wl with center and width values', async () => {
            await dcmj2pnm('/input.dcm', '/output.png', { windowCenter: 128, windowWidth: 256 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+Wl');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('128');
            expect(args[idx + 2]).toBe('256');
        });

        it('passes +F with frame number', async () => {
            await dcmj2pnm('/input.dcm', '/output.png', { frame: 5 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+F');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('5');
        });

        it('includes input and output paths at the end', async () => {
            await dcmj2pnm('/input.dcm', '/output.png');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 2]).toBe('/input.dcm');
            expect(args[args.length - 1]).toBe('/output.png');
        });

        it('omits optional flags when not specified', async () => {
            await dcmj2pnm('/input.dcm', '/output.png');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('+Wl');
            expect(args).not.toContain('+F');
        });
    });

    describe('binary fallback', () => {
        it('uses dcm2img when available', async () => {
            mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcm2img' });
            await dcmj2pnm('/input.dcm', '/output.png');
            expect(mockedExecCommand.mock.calls[0]?.[0]).toBe('/usr/local/bin/dcm2img');
        });

        it('falls back to dcmj2pnm when dcm2img not found', async () => {
            mockedResolveBinary
                .mockReturnValueOnce({ ok: false, error: new Error('dcm2img not found') })
                .mockReturnValueOnce({ ok: true, value: '/usr/local/bin/dcmj2pnm' });
            await dcmj2pnm('/input.dcm', '/output.png');
            expect(mockedResolveBinary).toHaveBeenCalledWith('dcm2img');
            expect(mockedResolveBinary).toHaveBeenCalledWith('dcmj2pnm');
            expect(mockedExecCommand.mock.calls[0]?.[0]).toBe('/usr/local/bin/dcmj2pnm');
        });

        it('returns error when neither binary is found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('binary not found') });
            const result = await dcmj2pnm('/input.dcm', '/output.png');
            expect(result.ok).toBe(false);
        });
    });

    describe('result handling', () => {
        it('returns outputPath on exit code 0', async () => {
            const result = await dcmj2pnm('/input.dcm', '/output.png');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.outputPath).toBe('/output.png');
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'cannot read file', exitCode: 1 },
            });
            const result = await dcmj2pnm('/input.dcm', '/output.png');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcmj2pnm('/input.dcm', '/output.png');
            expect(result.ok).toBe(false);
        });
    });

    describe('Dcmj2pnmOutputFormat constants', () => {
        it('has all 6 values', () => {
            expect(Object.keys(Dcmj2pnmOutputFormat)).toHaveLength(6);
        });

        it('includes PNG_16BIT', () => {
            expect(Dcmj2pnmOutputFormat.PNG_16BIT).toBe('png16');
        });

        it('values are unique strings', () => {
            const values = Object.values(Dcmj2pnmOutputFormat);
            expect(new Set(values).size).toBe(values.length);
        });
    });
});
