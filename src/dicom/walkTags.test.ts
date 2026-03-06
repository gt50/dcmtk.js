import { describe, it, expect } from 'vitest';
import { walkTags } from './walkTags';
import type { DicomJsonModel } from '../tools/_xmlToJson';

describe('walkTags', () => {
    const flatData: DicomJsonModel = {
        '00100010': { vr: 'PN', Value: [{ Alphabetic: 'Smith^John' }] },
        '00100020': { vr: 'LO', Value: ['PATIENT-001'] },
        '00080060': { vr: 'CS', Value: ['CT'] },
    };

    it('returns all tags from a flat dataset with depth 0', () => {
        const entries = walkTags(flatData);
        expect(entries).toHaveLength(3);
        for (const e of entries) {
            expect(e.depth).toBe(0);
        }
    });

    it('produces correct paths for flat tags', () => {
        const entries = walkTags(flatData);
        const paths = entries.map(e => e.path);
        expect(paths).toContain('00100010');
        expect(paths).toContain('00100020');
        expect(paths).toContain('00080060');
    });

    it('filters by VR', () => {
        const entries = walkTags(flatData, { vrFilter: ['PN'] });
        expect(entries).toHaveLength(1);
        expect(entries[0]!.tag).toBe('00100010');
    });

    it('returns empty array for empty dataset', () => {
        expect(walkTags({})).toHaveLength(0);
    });

    it('recurses into sequences with correct paths and depth', () => {
        const data: DicomJsonModel = {
            '00081115': {
                vr: 'SQ',
                Value: [{ '0020000E': { vr: 'UI', Value: ['1.2.3'] } }],
            },
        };
        const entries = walkTags(data);
        expect(entries).toHaveLength(2);

        const sqEntry = entries.find(e => e.tag === '00081115');
        expect(sqEntry).toBeDefined();
        expect(sqEntry!.depth).toBe(0);
        expect(sqEntry!.path).toBe('00081115');

        const nestedEntry = entries.find(e => e.tag === '0020000E');
        expect(nestedEntry).toBeDefined();
        expect(nestedEntry!.depth).toBe(1);
        expect(nestedEntry!.path).toBe('00081115[0].0020000E');
    });

    it('handles multiple sequence items with correct indices', () => {
        const data: DicomJsonModel = {
            '00081115': {
                vr: 'SQ',
                Value: [{ '0020000E': { vr: 'UI', Value: ['1.2.3'] } }, { '0020000E': { vr: 'UI', Value: ['4.5.6'] } }],
            },
        };
        const entries = walkTags(data, { vrFilter: ['UI'] });
        expect(entries).toHaveLength(2);
        expect(entries[0]!.path).toBe('00081115[0].0020000E');
        expect(entries[1]!.path).toBe('00081115[1].0020000E');
    });

    it('maxDepth: 0 prevents recursion into sequences', () => {
        const data: DicomJsonModel = {
            '00081115': {
                vr: 'SQ',
                Value: [{ '0020000E': { vr: 'UI', Value: ['1.2.3'] } }],
            },
        };
        const entries = walkTags(data, { maxDepth: 0 });
        expect(entries).toHaveLength(1);
        expect(entries[0]!.tag).toBe('00081115');
    });

    it('SQ filtered out but nested tags still visited', () => {
        const data: DicomJsonModel = {
            '00081115': {
                vr: 'SQ',
                Value: [{ '0020000E': { vr: 'UI', Value: ['1.2.3'] } }],
            },
        };
        const entries = walkTags(data, { vrFilter: ['UI'] });
        expect(entries).toHaveLength(1);
        expect(entries[0]!.tag).toBe('0020000E');
    });

    it('traverses deeply nested sequences up to default maxDepth', () => {
        let innermost: DicomJsonModel = { '00100020': { vr: 'LO', Value: ['DEEP'] } };
        for (let i = 0; i < 5; i++) {
            innermost = { '0040A730': { vr: 'SQ', Value: [innermost] } };
        }
        const entries = walkTags(innermost);
        const deep = entries.find(e => e.tag === '00100020');
        expect(deep).toBeDefined();
        expect(deep!.depth).toBe(5);
    });

    it('handles non-object sequence items gracefully', () => {
        const data: DicomJsonModel = {
            '00081115': {
                vr: 'SQ',
                Value: ['not-an-object' as unknown, { '0020000E': { vr: 'UI', Value: ['1.2.3'] } }],
            },
        };
        const entries = walkTags(data, { vrFilter: ['UI'] });
        expect(entries).toHaveLength(1);
        expect(entries[0]!.path).toBe('00081115[1].0020000E');
    });

    it('handles SQ element with no Value property', () => {
        const data: DicomJsonModel = {
            '00081115': { vr: 'SQ' },
        };
        const entries = walkTags(data);
        expect(entries).toHaveLength(1);
        expect(entries[0]!.tag).toBe('00081115');
    });
});
