import { describe, it, expect, vi } from 'vitest';
import { StorescpEvent, STORESCP_PATTERNS, STORESCP_FATAL_EVENTS } from './storescp';
import { DcmrecvEvent } from './dcmrecv';
import { LineParser } from '../parsers/LineParser';

describe('StorescpEvent constants', () => {
    it('includes all dcmrecv events', () => {
        for (const key of Object.keys(DcmrecvEvent)) {
            expect(StorescpEvent).toHaveProperty(key);
        }
    });

    it('has additional storescp-specific events', () => {
        expect(StorescpEvent.STORING_FILE).toBe('STORING_FILE');
        expect(StorescpEvent.SUBDIRECTORY_CREATED).toBe('SUBDIRECTORY_CREATED');
    });

    it('has all expected events (dcmrecv + storescp-specific)', () => {
        expect(Object.keys(StorescpEvent)).toHaveLength(14);
    });
});

describe('STORESCP_FATAL_EVENTS', () => {
    it('contains CANNOT_START_LISTENER', () => {
        expect(STORESCP_FATAL_EVENTS.has(StorescpEvent.CANNOT_START_LISTENER)).toBe(true);
    });
});

describe('STORESCP_PATTERNS with LineParser', () => {
    function createParser() {
        const parser = new LineParser();
        for (const pattern of STORESCP_PATTERNS) {
            parser.addPattern(pattern);
        }
        return parser;
    }

    it('matches inherited LISTENING pattern', () => {
        const parser = createParser();
        const events: Array<{ event: string; data: unknown }> = [];
        parser.on('match', evt => events.push(evt));

        parser.feed('I: listening on port 11112');

        expect(events).toHaveLength(1);
        expect(events[0]?.event).toBe(StorescpEvent.LISTENING);
    });

    it('matches inherited STORED_FILE pattern', () => {
        const parser = createParser();
        const events: Array<{ event: string; data: unknown }> = [];
        parser.on('match', evt => events.push(evt));

        parser.feed('I: Stored received object to file: /output/study/image.dcm');

        expect(events).toHaveLength(1);
        expect(events[0]?.event).toBe(StorescpEvent.STORED_FILE);
    });

    it('matches STORING_FILE pattern', () => {
        const parser = createParser();
        const events: Array<{ event: string; data: unknown }> = [];
        parser.on('match', evt => events.push(evt));

        parser.feed('I: storing DICOM file: /output/CT.1.2.3.dcm');

        expect(events).toHaveLength(1);
        expect(events[0]?.event).toBe(StorescpEvent.STORING_FILE);
        const data = events[0]?.data as { filePath: string };
        expect(data.filePath).toBe('/output/CT.1.2.3.dcm');
    });

    it('matches SUBDIRECTORY_CREATED pattern', () => {
        const parser = createParser();
        const events: Array<{ event: string; data: unknown }> = [];
        parser.on('match', evt => events.push(evt));

        parser.feed('I: created new subdirectory: /output/2024-01-15');

        expect(events).toHaveLength(1);
        expect(events[0]?.event).toBe(StorescpEvent.SUBDIRECTORY_CREATED);
        const data = events[0]?.data as { directory: string };
        expect(data.directory).toBe('/output/2024-01-15');
    });

    it('matches storescp ASSOCIATION_RECEIVED with empty fields', () => {
        const parser = createParser();
        const events: Array<{ event: string; data: unknown }> = [];
        parser.on('match', evt => events.push(evt));

        parser.feed('I: Association Received');

        expect(events).toHaveLength(1);
        expect(events[0]?.event).toBe(StorescpEvent.ASSOCIATION_RECEIVED);
        const data = events[0]?.data as { source: string; callingAE: string; calledAE: string };
        expect(data.source).toBe('');
        expect(data.callingAE).toBe('');
        expect(data.calledAE).toBe('');
    });

    it('matches ASSOCIATION_RELEASE (storescp format)', () => {
        const parser = createParser();
        const events: Array<{ event: string; data: unknown }> = [];
        parser.on('match', evt => events.push(evt));

        parser.feed('I: Association Release');

        expect(events).toHaveLength(1);
        expect(events[0]?.event).toBe(StorescpEvent.ASSOCIATION_RELEASE);
    });

    it('includes all dcmrecv patterns plus storescp-specific ones', () => {
        expect(STORESCP_PATTERNS.length).toBe(12);
    });

    it('does not match unrelated output', () => {
        const parser = createParser();
        const events: Array<{ event: string; data: unknown }> = [];
        parser.on('match', evt => events.push(evt));

        parser.feed('D: debug information');
        parser.feed('some unrelated output');

        expect(events).toHaveLength(0);
    });

    describe('negative cases', () => {
        it('does not match empty string', () => {
            const parser = createParser();
            const spy = vi.fn();
            parser.on('match', spy);
            parser.feed('');
            expect(spy).not.toHaveBeenCalled();
        });

        it('does not match STORING_FILE prefix without path', () => {
            const parser = createParser();
            const spy = vi.fn();
            parser.on('match', spy);
            parser.feed('I: storing DICOM file:');
            expect(spy).not.toHaveBeenCalled();
        });

        it('matches ASSOCIATION_RECEIVED even with extra detail (storescp override)', () => {
            const parser = createParser();
            const events: Array<{ event: string; data: unknown }> = [];
            parser.on('match', evt => events.push(evt));
            parser.feed('I: Association Received db: STORESCU -> DCMRECV');
            // storescp uses a broad regex that matches any "Association Received" line
            expect(events.length).toBeGreaterThanOrEqual(1);
            expect(events[0]?.event).toBe(StorescpEvent.ASSOCIATION_RECEIVED);
        });

        it('does not match STORED_FILE prefix without file path', () => {
            const parser = createParser();
            const spy = vi.fn();
            parser.on('match', spy);
            parser.feed('I: Stored received object to file:');
            expect(spy).not.toHaveBeenCalled();
        });

        it('does not match CANNOT_START_LISTENER with unrelated "cannot" text', () => {
            const parser = createParser();
            const spy = vi.fn();
            parser.on('match', spy);
            parser.feed('E: cannot open file');
            expect(spy).not.toHaveBeenCalled();
        });

        it('does not match random prefixed noise', () => {
            const parser = createParser();
            const spy = vi.fn();
            parser.on('match', spy);
            parser.feed('W: warning about something');
            parser.feed('T: trace level message');
            parser.feed('   leading whitespace line');
            expect(spy).not.toHaveBeenCalled();
        });
    });
});
