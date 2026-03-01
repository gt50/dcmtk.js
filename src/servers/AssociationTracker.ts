/**
 * Pure state machine tracking DICOM association lifecycle.
 *
 * No I/O, no async, no EventEmitter — just state transitions.
 * Used by Dcmrecv and StoreSCP to correlate files to associations.
 *
 * State machine:
 * ```
 * IDLE -> [beginAssociation] -> ACTIVE -> [trackFile]* -> [endAssociation] -> IDLE
 * ```
 *
 * This single-slot design is safe because all DCMTK server binaries
 * (dcmrecv, storescp, etc.) are single-threaded and handle one
 * association at a time. Concurrent connections queue at the TCP level,
 * so associations never interleave in the output stream.
 *
 * @module servers/AssociationTracker
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Context for the currently active association. */
interface AssociationContext {
    readonly associationId: string;
    readonly callingAE: string;
    readonly calledAE: string;
    readonly source: string;
    readonly startTime: number;
    readonly files: string[];
}

/** A file enriched with association context. */
interface TrackedFile {
    readonly filePath: string;
    readonly associationId: string;
    readonly callingAE: string;
    readonly calledAE: string;
    readonly source: string;
}

/** Summary emitted when an association completes. */
interface AssociationSummary {
    readonly associationId: string;
    readonly callingAE: string;
    readonly calledAE: string;
    readonly source: string;
    readonly files: readonly string[];
    readonly durationMs: number;
    readonly endReason: 'release' | 'abort';
}

// ---------------------------------------------------------------------------
// AssociationTracker class
// ---------------------------------------------------------------------------

/**
 * Tracks DICOM association lifecycle for file-to-source correlation.
 *
 * Maintains a simple IDLE/ACTIVE state machine. While active, all tracked
 * files are enriched with the current association context. Only one
 * association can be active at a time — this is safe because DCMTK
 * servers are single-threaded and process associations sequentially.
 *
 * @example
 * ```ts
 * const tracker = new AssociationTracker();
 * const id = tracker.beginAssociation({ callingAE: 'SCU', calledAE: 'SCP', source: 'db' });
 * const file = tracker.trackFile('/path/to/received.dcm');
 * const summary = tracker.endAssociation('release');
 * ```
 */
class AssociationTracker {
    private association: AssociationContext | undefined;
    private counter = 0;

    /**
     * Begins a new association, transitioning from IDLE to ACTIVE.
     *
     * If an association is already active, it is silently ended (abort)
     * and the new one begins.
     *
     * @param data - Association metadata
     * @returns The unique association ID
     */
    beginAssociation(data: { readonly callingAE: string; readonly calledAE: string; readonly source: string }): string {
        this.counter++;
        const associationId = `assoc-${String(this.counter)}`;
        this.association = {
            associationId,
            callingAE: data.callingAE,
            calledAE: data.calledAE,
            source: data.source,
            startTime: Date.now(),
            files: [],
        };
        return associationId;
    }

    /**
     * Tracks a file received during the current association.
     *
     * If no association is active, returns a TrackedFile with empty context.
     *
     * @param filePath - Path to the received file
     * @returns A TrackedFile enriched with association context
     */
    trackFile(filePath: string): TrackedFile {
        if (this.association === undefined) {
            return {
                filePath,
                associationId: '',
                callingAE: '',
                calledAE: '',
                source: '',
            };
        }
        this.association.files.push(filePath);
        return {
            filePath,
            associationId: this.association.associationId,
            callingAE: this.association.callingAE,
            calledAE: this.association.calledAE,
            source: this.association.source,
        };
    }

    /**
     * Ends the current association, transitioning from ACTIVE to IDLE.
     *
     * @param reason - Why the association ended
     * @returns An AssociationSummary, or undefined if no association was active
     */
    endAssociation(reason: 'release' | 'abort'): AssociationSummary | undefined {
        if (this.association === undefined) return undefined;

        const summary: AssociationSummary = {
            associationId: this.association.associationId,
            callingAE: this.association.callingAE,
            calledAE: this.association.calledAE,
            source: this.association.source,
            files: [...this.association.files],
            durationMs: Date.now() - this.association.startTime,
            endReason: reason,
        };

        this.association = undefined;
        return summary;
    }

    /** The currently active association context, or undefined. */
    get current(): AssociationContext | undefined {
        return this.association;
    }

    /** Whether an association is currently active. */
    get isActive(): boolean {
        return this.association !== undefined;
    }

    /** Resets the tracker to IDLE, discarding any active association. */
    reset(): void {
        this.association = undefined;
    }
}

export { AssociationTracker };
export type { AssociationContext, TrackedFile, AssociationSummary };
