import { describe, it, expect } from 'vitest';
import { parseAETitle, parsePort, parseDicomTag, parseDicomTagPath, parseSOPClassUID, parseTransferSyntaxUID } from './validation';
import { createDicomTag, createAETitle, createPort, createDicomTagPath, createSOPClassUID, createTransferSyntaxUID } from './brands';

describe('validation parse functions', () => {
    describe('parseAETitle()', () => {
        it('accepts valid AE title from unknown input', () => {
            const result = parseAETitle('STORESCU');
            expect(result.ok).toBe(true);
            if (result.ok) expect(result.value).toBe('STORESCU');
        });

        it('rejects non-string input', () => {
            const result = parseAETitle(42);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });

        it('rejects null', () => {
            const result = parseAETitle(null);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });

        it('rejects undefined', () => {
            const result = parseAETitle(undefined);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });

        it('rejects empty string', () => {
            const result = parseAETitle('');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });

        it('rejects too long', () => {
            const result = parseAETitle('A'.repeat(17));
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });
    });

    describe('parsePort()', () => {
        it('accepts valid port from unknown input', () => {
            const result = parsePort(11112);
            expect(result.ok).toBe(true);
            if (result.ok) expect(result.value).toBe(11112);
        });

        it('rejects string input', () => {
            const result = parsePort('8080');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });

        it('rejects zero', () => {
            const result = parsePort(0);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });

        it('rejects 65536', () => {
            const result = parsePort(65536);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });

        it('rejects float', () => {
            const result = parsePort(80.5);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });

        it('rejects null', () => {
            const result = parsePort(null);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });
    });

    describe('parseDicomTag()', () => {
        it('accepts valid tag from unknown input', () => {
            const result = parseDicomTag('(0010,0010)');
            expect(result.ok).toBe(true);
        });

        it('rejects non-string', () => {
            const result = parseDicomTag(12345);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });

        it('rejects malformed tag', () => {
            const result = parseDicomTag('0010,0010');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });
    });

    describe('parseDicomTagPath()', () => {
        it('accepts single tag as path', () => {
            const result = parseDicomTagPath('(0010,0010)');
            expect(result.ok).toBe(true);
        });

        it('accepts multi-segment path', () => {
            const result = parseDicomTagPath('(0040,0275)[0].(0008,1155)');
            expect(result.ok).toBe(true);
        });

        it('rejects empty string', () => {
            const result = parseDicomTagPath('');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });

        it('rejects non-string', () => {
            const result = parseDicomTagPath(123);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });
    });

    describe('parseSOPClassUID()', () => {
        it('accepts valid UID', () => {
            const result = parseSOPClassUID('1.2.840.10008.5.1.4.1.1.2');
            expect(result.ok).toBe(true);
        });

        it('rejects non-numeric UID', () => {
            const result = parseSOPClassUID('1.2.abc');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });

        it('rejects non-string', () => {
            const result = parseSOPClassUID(42);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });
    });

    describe('parseTransferSyntaxUID()', () => {
        it('accepts valid UID', () => {
            const result = parseTransferSyntaxUID('1.2.840.10008.1.2');
            expect(result.ok).toBe(true);
        });

        it('rejects empty', () => {
            const result = parseTransferSyntaxUID('');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBeInstanceOf(Error);
                expect(result.error.message).toBeTruthy();
            }
        });
    });
});

describe('branded type round-trip invariants', () => {
    it('DicomTag: parse(create(x)) succeeds', () => {
        const created = createDicomTag('(0010,0010)');
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const result = parseDicomTag(created.value);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(created.value);
    });

    it('AETitle: parse(create(x)) succeeds', () => {
        const created = createAETitle('MYSCP');
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const result = parseAETitle(created.value);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(created.value);
    });

    it('Port: parse(create(x)) succeeds', () => {
        const created = createPort(4242);
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const result = parsePort(created.value);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(created.value);
    });

    it('DicomTagPath: parse(create(x)) succeeds', () => {
        const created = createDicomTagPath('(0010,0010)');
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const result = parseDicomTagPath(created.value);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(created.value);
    });

    it('SOPClassUID: parse(create(x)) succeeds', () => {
        const created = createSOPClassUID('1.2.840.10008.5.1.4.1.1.2');
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const result = parseSOPClassUID(created.value);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(created.value);
    });

    it('TransferSyntaxUID: parse(create(x)) succeeds', () => {
        const created = createTransferSyntaxUID('1.2.840.10008.1.2');
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const result = parseTransferSyntaxUID(created.value);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(created.value);
    });
});
