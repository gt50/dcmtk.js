import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dcmodify } from './dcmodify';

vi.mock('../exec', () => ({
    spawnCommand: vi.fn(),
}));

vi.mock('./_resolveBinary', () => ({
    resolveBinary: vi.fn(),
}));

import { spawnCommand } from '../exec';
import { resolveBinary } from './_resolveBinary';

const mockedSpawnCommand = vi.mocked(spawnCommand);
const mockedResolveBinary = vi.mocked(resolveBinary);

beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveBinary.mockReturnValue({ ok: true, value: '/usr/local/bin/dcmodify' });
    mockedSpawnCommand.mockResolvedValue({
        ok: true,
        value: { stdout: '', stderr: '', exitCode: 0 },
    });
});

describe('dcmodify', () => {
    describe('argument building', () => {
        it('passes -v for verbose verbosity', async () => {
            await dcmodify('/input.dcm', {
                modifications: [{ tag: '(0010,0010)', value: 'DOE^JOHN' }],
                verbosity: 'verbose',
            });
            const args = mockedSpawnCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-v');
        });

        it('passes -d for debug verbosity', async () => {
            await dcmodify('/input.dcm', {
                modifications: [{ tag: '(0010,0010)', value: 'DOE^JOHN' }],
                verbosity: 'debug',
            });
            const args = mockedSpawnCommand.mock.calls[0]?.[1] as string[];
            expect(args).toContain('-d');
        });

        it('omits verbosity flag when not specified', async () => {
            await dcmodify('/input.dcm', {
                modifications: [{ tag: '(0010,0010)', value: 'DOE^JOHN' }],
            });
            const args = mockedSpawnCommand.mock.calls[0]?.[1] as string[];
            expect(args).not.toContain('-v');
            expect(args).not.toContain('-d');
        });
    });

    describe('result handling', () => {
        it('returns filePath on success', async () => {
            const result = await dcmodify('/input.dcm', {
                modifications: [{ tag: '(0010,0010)', value: 'DOE^JOHN' }],
            });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.filePath).toBe('/input.dcm');
            }
        });

        it('returns error on non-zero exit code', async () => {
            mockedSpawnCommand.mockResolvedValue({
                ok: true,
                value: { stdout: '', stderr: 'modification failed', exitCode: 1 },
            });
            const result = await dcmodify('/input.dcm', {
                modifications: [{ tag: '(0010,0010)', value: 'DOE^JOHN' }],
            });
            expect(result.ok).toBe(false);
        });

        it('returns error when binary not found', async () => {
            mockedResolveBinary.mockReturnValue({ ok: false, error: new Error('not found') });
            const result = await dcmodify('/input.dcm', {
                modifications: [{ tag: '(0010,0010)', value: 'DOE^JOHN' }],
            });
            expect(result.ok).toBe(false);
        });

        it('returns error when spawn fails', async () => {
            mockedSpawnCommand.mockResolvedValue({ ok: false, error: new Error('spawn failed') });
            const result = await dcmodify('/input.dcm', {
                modifications: [{ tag: '(0010,0010)', value: 'DOE^JOHN' }],
            });
            expect(result.ok).toBe(false);
        });
    });
});
