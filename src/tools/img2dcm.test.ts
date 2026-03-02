import { describe, it, expect, vi, beforeEach } from 'vitest';
import { img2dcm, Img2dcmInputFormat } from './img2dcm';

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
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/img2dcm' });
    mockedExecCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('img2dcm', () => {
    describe('validation', () => {
        it('rejects invalid input format', async () => {
            const result = await img2dcm('/photo.jpg', '/output.dcm', { inputFormat: 'gif' as never });
            expect(result.ok).toBe(false);
        });

        it('accepts all input format values', async () => {
            for (const format of Object.values(Img2dcmInputFormat)) {
                const result = await img2dcm('/photo.jpg', '/output.dcm', { inputFormat: format });
                expect(result.ok).toBe(true);
            }
        });
    });

    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await img2dcm('/photo.jpg', '/output.dcm', { verbosity: 'verbose' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await img2dcm('/photo.jpg', '/output.dcm', { verbosity: 'debug' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await img2dcm('/photo.jpg', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });

        it('passes -i JPEG for jpeg input format', async () => {
            await img2dcm('/photo.jpg', '/output.dcm', { inputFormat: 'jpeg' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-i');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('JPEG');
        });

        it('passes -i BMP for bmp input format', async () => {
            await img2dcm('/photo.bmp', '/output.dcm', { inputFormat: 'bmp' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-i');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('BMP');
        });

        it('passes -df with datasetFrom path', async () => {
            await img2dcm('/photo.jpg', '/output.dcm', { datasetFrom: '/template.dcm' });
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            const idx = args.indexOf('-df');
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe('/template.dcm');
        });

        it('includes input and output paths at the end', async () => {
            await img2dcm('/photo.jpg', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args[args.length - 2]).toBe('/photo.jpg');
            expect(args[args.length - 1]).toBe('/output.dcm');
        });

        it('omits optional flags when not specified', async () => {
            await img2dcm('/photo.jpg', '/output.dcm');
            const args = mockedExecCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-i');
            expect(args).not.toContain('-df');
        });
    });

    describe('result handling', () => {
        it('returns outputPath on success', async () => {
            const result = await img2dcm('/photo.jpg', '/output.dcm');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.outputPath).toBe('/output.dcm');
            }
        });

        it('returns error on non-zero exit', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'cannot read file', exitCode: 1 },
            });
            const result = await img2dcm('/photo.jpg', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('DCMTK not found') });
            const result = await img2dcm('/photo.jpg', '/output.dcm');
            expect(result.ok).toBe(false);
        });

        it('returns error when exec fails', async () => {
            mockedExecCommand.mockResolvedValue({
                ok: false,
                error: new Error('exec failed'),
            });
            const result = await img2dcm('/photo.jpg', '/output.dcm');
            expect(result.ok).toBe(false);
        });
    });

    describe('Img2dcmInputFormat constants', () => {
        it('has 2 values', () => {
            expect(Object.keys(Img2dcmInputFormat)).toHaveLength(2);
        });

        it('includes JPEG and BMP', () => {
            expect(Img2dcmInputFormat.JPEG).toBe('jpeg');
            expect(Img2dcmInputFormat.BMP).toBe('bmp');
        });
    });
});
