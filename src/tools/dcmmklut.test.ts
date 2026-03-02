import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmmklut, LutType } from './dcmmklut';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmmklut' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcmmklut', () => {
    describe('argument building', () => {
        it('passes -v for verbose', async () => {
            await dcmmklut('/output.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug', async () => {
            await dcmmklut('/output.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity when not specified', async () => {
            await dcmmklut('/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes +Tm for modality LUT type', async () => {
            await dcmmklut('/output.dcm', { lutType: LutType.MODALITY });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+Tm');
        });

        it('passes +Tp for presentation LUT type', async () => {
            await dcmmklut('/output.dcm', { lutType: LutType.PRESENTATION });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+Tp');
        });

        it('passes +Tv for voi LUT type', async () => {
            await dcmmklut('/output.dcm', { lutType: LutType.VOI });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('+Tv');
        });

        it('passes +Cg with gamma value', async () => {
            await dcmmklut('/output.dcm', { gamma: 2.2 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('+Cg');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('2.2');
        });

        it('passes -e with entries count', async () => {
            await dcmmklut('/output.dcm', { entries: 256 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-e');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('256');
        });

        it('passes -b with bits value', async () => {
            await dcmmklut('/output.dcm', { bits: 12 });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-b');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('12');
        });

        it('includes output path at the end', async () => {
            await dcmmklut('/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 1]).toBe('/output.dcm');
        });
    });

    describe('LutType constants', () => {
        it('has 3 values', () => {
            expect(Object.keys(LutType)).toHaveLength(3);
        });

        it('has correct values', () => {
            expect(LutType.MODALITY).toBe('modality');
            expect(LutType.PRESENTATION).toBe('presentation');
            expect(LutType.VOI).toBe('voi');
        });
    });

    describe('result handling', () => {
        it('returns success with outputPath', async () => {
            const result = await dcmmklut('/output.dcm');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.outputPath).toBe('/output.dcm');
            }
        });

        it('returns error on non-zero exit', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'lut error', exitCode: 1 },
            });
            const result = await dcmmklut('/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await dcmmklut('/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await dcmmklut('/output.dcm');
            expect(result.ok).toBe(false);
        });
    });
});
