import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AssociationTracker } from './AssociationTracker';

describe('AssociationTracker', () => {
    let tracker: AssociationTracker;

    beforeEach(() => {
        tracker = new AssociationTracker();
    });

    describe('initial state', () => {
        it('starts in IDLE state', () => {
            expect(tracker.isActive).toBe(false);
        });

        it('current is undefined when IDLE', () => {
            expect(tracker.current).toBeUndefined();
        });
    });

    describe('beginAssociation()', () => {
        it('transitions to ACTIVE state', () => {
            tracker.beginAssociation({ callingAE: 'SCU', calledAE: 'SCP', source: 'db' });
            expect(tracker.isActive).toBe(true);
        });

        it('returns a unique association ID', () => {
            const id1 = tracker.beginAssociation({ callingAE: 'SCU', calledAE: 'SCP', source: 'db' });
            tracker.endAssociation('release');
            const id2 = tracker.beginAssociation({ callingAE: 'SCU', calledAE: 'SCP', source: 'db' });
            expect(id1).not.toBe(id2);
        });

        it('sets the current context', () => {
            tracker.beginAssociation({ callingAE: 'MYSCU', calledAE: 'MYSCP', source: 'net' });
            const ctx = tracker.current;
            expect(ctx).toBeDefined();
            expect(ctx?.callingAE).toBe('MYSCU');
            expect(ctx?.calledAE).toBe('MYSCP');
            expect(ctx?.source).toBe('net');
            expect(ctx?.files).toHaveLength(0);
        });

        it('silently replaces active association', () => {
            const id1 = tracker.beginAssociation({ callingAE: 'A', calledAE: 'B', source: 'db' });
            const id2 = tracker.beginAssociation({ callingAE: 'C', calledAE: 'D', source: 'db' });
            expect(id1).not.toBe(id2);
            expect(tracker.current?.callingAE).toBe('C');
        });
    });

    describe('trackFile()', () => {
        it('returns enriched TrackedFile when active', () => {
            const id = tracker.beginAssociation({ callingAE: 'SCU', calledAE: 'SCP', source: 'db' });
            const tracked = tracker.trackFile('/tmp/file1.dcm');

            expect(tracked.filePath).toBe('/tmp/file1.dcm');
            expect(tracked.associationId).toBe(id);
            expect(tracked.callingAE).toBe('SCU');
            expect(tracked.calledAE).toBe('SCP');
            expect(tracked.source).toBe('db');
        });

        it('accumulates files in the context', () => {
            tracker.beginAssociation({ callingAE: 'SCU', calledAE: 'SCP', source: 'db' });
            tracker.trackFile('/tmp/file1.dcm');
            tracker.trackFile('/tmp/file2.dcm');
            tracker.trackFile('/tmp/file3.dcm');

            expect(tracker.current?.files).toHaveLength(3);
        });

        it('returns empty context when IDLE', () => {
            const tracked = tracker.trackFile('/tmp/orphan.dcm');

            expect(tracked.filePath).toBe('/tmp/orphan.dcm');
            expect(tracked.associationId).toBe('');
            expect(tracked.callingAE).toBe('');
            expect(tracked.calledAE).toBe('');
            expect(tracked.source).toBe('');
        });
    });

    describe('endAssociation()', () => {
        it('returns summary on release', () => {
            vi.useFakeTimers();
            tracker.beginAssociation({ callingAE: 'SCU', calledAE: 'SCP', source: 'db' });
            tracker.trackFile('/tmp/file1.dcm');
            tracker.trackFile('/tmp/file2.dcm');

            vi.advanceTimersByTime(100);
            const summary = tracker.endAssociation('release');

            expect(summary).toBeDefined();
            expect(summary?.callingAE).toBe('SCU');
            expect(summary?.calledAE).toBe('SCP');
            expect(summary?.source).toBe('db');
            expect(summary?.files).toHaveLength(2);
            expect(summary?.endReason).toBe('release');
            expect(summary?.durationMs).toBeGreaterThanOrEqual(100);

            vi.useRealTimers();
        });

        it('returns summary on abort', () => {
            tracker.beginAssociation({ callingAE: 'SCU', calledAE: 'SCP', source: 'db' });
            const summary = tracker.endAssociation('abort');

            expect(summary?.endReason).toBe('abort');
        });

        it('transitions to IDLE', () => {
            tracker.beginAssociation({ callingAE: 'SCU', calledAE: 'SCP', source: 'db' });
            tracker.endAssociation('release');

            expect(tracker.isActive).toBe(false);
            expect(tracker.current).toBeUndefined();
        });

        it('returns undefined when already IDLE', () => {
            const summary = tracker.endAssociation('release');
            expect(summary).toBeUndefined();
        });

        it('returns a copy of files (not reference)', () => {
            tracker.beginAssociation({ callingAE: 'SCU', calledAE: 'SCP', source: 'db' });
            tracker.trackFile('/tmp/file.dcm');
            const summary = tracker.endAssociation('release');

            expect(summary?.files).toEqual(['/tmp/file.dcm']);
        });
    });

    describe('reset()', () => {
        it('transitions to IDLE discarding active association', () => {
            tracker.beginAssociation({ callingAE: 'SCU', calledAE: 'SCP', source: 'db' });
            tracker.trackFile('/tmp/file.dcm');
            tracker.reset();

            expect(tracker.isActive).toBe(false);
            expect(tracker.current).toBeUndefined();
        });

        it('is safe to call when already IDLE', () => {
            tracker.reset();
            expect(tracker.isActive).toBe(false);
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });
});
