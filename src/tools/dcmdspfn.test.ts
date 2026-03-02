import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmdspfn } from './dcmdspfn';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmdspfn' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: 'display function output', stderr: '', exitCode: 0 },
    });
});

describe('dcmdspfn', () => {
    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await dcmdspfn({ verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await dcmdspfn({ verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dcmdspfn();
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes +Im with monitor file path', async () => {
            await dcmdspfn({ monitorFile: '/path/to/monitor.lut' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+Im');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('/path/to/monitor.lut');
        });

        it('passes +Ic with camera file path', async () => {
            await dcmdspfn({ cameraFile: '/path/to/camera.lut' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+Ic');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('/path/to/camera.lut');
        });

        it('passes +Ip with printer file path', async () => {
            await dcmdspfn({ printerFile: '/path/to/printer.lut' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+Ip');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('/path/to/printer.lut');
        });

        it('passes +Ca with ambient light value', async () => {
            await dcmdspfn({ ambientLight: 10 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+Ca');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('10');
        });
    });

    describe('validation', () => {
        it('rejects empty monitorFile', async () => {
            const result = await dcmdspfn({ monitorFile: '' });
            expect(result.ok).toBe(false);
        });

        it('rejects non-positive ambientLight', async () => {
            const result = await dcmdspfn({ ambientLight: 0 });
            expect(result.ok).toBe(false);
        });

        it('accepts no options', async () => {
            const result = await dcmdspfn();
            expect(result.ok).toBe(true);
        });
    });

    describe('result handling', () => {
        it('returns text on success', async () => {
            const result = await dcmdspfn();
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.text).toBe('display function output');
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'display function failed', exitCode: 1 },
            });
            const result = await dcmdspfn();
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dcmdspfn();
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcmdspfn();
            expect(result.ok).toBe(false);
        });
    });
});
